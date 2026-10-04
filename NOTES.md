# Passline: Study Notes

Read this once top to bottom, then use sections 7 to 9 as your revision sheet before interviews.

---

## 1. What you built, in one paragraph

Passline lets **organizers** publish events and **attendees** register for them. Each registration produces a **QR ticket**. At the door the organizer scans tickets (camera, USB scanner, or pasted code), which marks the person as checked in and pushes the change to a **live dashboard**. After check-in, attendees can download a **PDF certificate** whose QR code opens a public page that verifies it. Attendees can also join an event's **volunteer team**, and organizers manage a **task board** for them.

Two roles exist: `student` (attendee) and `organizer`.

---

## 2. Architecture

```
 Browser (React SPA)                      Node.js + Express                 SQLite
 ┌────────────────────┐   HTTPS/JSON    ┌───────────────────────┐        ┌───────────┐
 │ Pages, components  │ ──────────────► │ helmet, rate limit    │        │ users     │
 │ api.js (fetch+JWT) │                 │ auth middleware (JWT) │ ─────► │ events    │
 │ EventSource (SSE)  │ ◄────────────── │ routes + zod checks   │ ◄───── │ registrations
 └────────────────────┘   JSON / SSE    │ pdfkit, qrcode        │        │ volunteers│
                                        │ event bus (SSE push)  │        │ tasks     │
                                        └───────────────────────┘        └───────────┘
```

**Layers inside the server** (a pattern you should name in interviews):

1. **Transport:** Express, JSON body parsing, security headers, rate limiting (`app.js`).
2. **Authentication and authorization:** `auth.js` verifies the JWT and checks roles; `ownEvent` checks that an organizer owns the event they touch.
3. **Validation:** zod schemas reject bad input before it reaches the database.
4. **Data access:** parameterized SQL through better-sqlite3 (`db.js`).
5. **Side effects:** PDF/QR generation and the event bus.

In production the Express server also serves the built React files, so you deploy **one** process.

### File map

| Path | Purpose |
|---|---|
| `server/src/db.js` | Schema (5 tables, constraints, indexes) |
| `server/src/auth.js` | Sign/verify JWT, `auth`, `streamAuth`, `requireRole` |
| `server/src/routes/auth.js` | Register, login, me |
| `server/src/routes/events.js` | Event CRUD, attendees, analytics, live stream |
| `server/src/routes/registrations.js` | Register, cancel, tickets, check-in, certificates, verify |
| `server/src/routes/tasks.js` | Volunteering and the task board |
| `server/src/bus.js` | Event emitter that feeds live updates |
| `server/test/smoke.mjs` | End-to-end API test |
| `client/src/App.jsx` | Router, auth context, route guards, nav |
| `client/src/api.js` | `fetch` wrapper that attaches the JWT |
| `client/src/pages/*` | Screens |
| `client/src/components/TaskBoard.jsx` | Reused by organizer and volunteers |

---

## 3. Fundamentals you must be able to explain

### 3.1 Client-server and REST
The browser (client) asks, the server answers. Our API is **REST-style**: URLs name resources (`/events/5/attendees`), HTTP methods name the action (`GET` read, `POST` create, `PUT` replace, `PATCH` partial update, `DELETE` remove), and status codes carry the outcome.

Status codes used here: `200/201/204` success, `400` invalid input, `401` not signed in, `403` signed in but not allowed, `404` not found, `409` conflict (full, duplicate, already checked in).

**401 vs 403** is a classic question: 401 means "I don't know who you are", 403 means "I know who you are and the answer is no".

### 3.2 Passwords: hashing, not encryption
We never store passwords. `bcrypt` turns a password into a hash that is deliberately slow and salted (a random value mixed in, so identical passwords produce different hashes). On login we hash the attempt and compare. If the database leaks, attackers still have to brute-force each hash slowly.

Login returns the same error for "unknown email" and "wrong password" so attackers cannot discover which emails exist.

### 3.3 JWT authentication
After login the server returns a **JSON Web Token**: `header.payload.signature`. The payload holds `{ sub: userId, role }` and an expiry. The signature is an HMAC with a server secret, so the client cannot change the role without the signature breaking.

Each request sends `Authorization: Bearer <token>`. The `auth` middleware verifies the signature and expiry and sets `req.user`. **No session is stored on the server** (stateless), which makes scaling horizontally easy.

Trade-offs to mention honestly:
- A JWT cannot be revoked before it expires unless you keep a denylist or use short-lived tokens plus refresh tokens.
- We keep the token in `localStorage`, which is simple but exposed to XSS. The more hardened option is an `HttpOnly` cookie plus CSRF protection.

### 3.4 Authorization (RBAC and ownership)
Authentication is *who you are*; authorization is *what you may do*. Two layers here:
- **Role check:** `requireRole('organizer')` on organizer routes.
- **Ownership check:** `ownEvent` ensures an organizer can only manage **their own** events. Without it, any organizer could read another organizer's attendees by changing the ID in the URL (this bug class is called **IDOR**, insecure direct object reference).

Tasks add a third rule: the assigned volunteer may change only the *status* of their own task; the organizer may change anything.

### 3.5 Relational modeling
```
users 1───< events            (organizer_id)
users >───< events  via registrations (event_id, user_id, ticket_code, checked_in_at, cert_id)
users >───< events  via volunteers    (event_id, user_id)
events 1───< tasks            (assignee_id → users, nullable)
```
Key ideas:
- **Junction tables** model many-to-many relationships (`registrations`, `volunteers`).
- `UNIQUE (event_id, user_id)` is the real guarantee against double registration. The database enforces it even if two requests collide.
- `CHECK` constraints (`capacity > 0`, valid role/status values) protect data integrity at the lowest level.
- `ON DELETE CASCADE` removes registrations and tasks when an event is deleted.
- An **index** on `registrations(event_id)` keeps "all attendees of event X" fast as the table grows.

### 3.6 Transactions and race conditions (the most impressive topic here)
**Problem:** capacity is 1 and two people click Register at the same instant. Both read "0 registered", both insert, and you oversell.

**Our fix:** the count-then-insert logic runs inside a `db.transaction(...)`. better-sqlite3 runs it synchronously, so no other request can interleave. In PostgreSQL you would get the same safety with `SELECT ... FOR UPDATE` on the event row, or a single conditional `INSERT ... SELECT ... WHERE (count) < capacity`.

**Check-in uses a different technique:** a single atomic statement:
```sql
UPDATE registrations SET checked_in_at = ?, cert_id = ?
WHERE id = ? AND checked_in_at IS NULL
```
If two volunteers scan the same ticket together, only one `UPDATE` changes a row (`info.changes === 1`); the other gets `0` and we answer "already checked in". This is **optimistic, compare-and-set style concurrency control**, with no explicit lock.

### 3.7 QR tickets
At registration we generate `ticket_code = randomBytes(12)` (96 bits, base64url). It is unguessable, so nobody can forge a ticket by trying codes. The QR image encodes `PL:<code>`; the prefix lets the scanner reject unrelated QR codes quickly. The server renders the QR as a PNG data URL (`qrcode` library) when you open My tickets.

A ticket is only valid **for the event it belongs to**: the check-in query matches both `event_id` and `ticket_code`.

### 3.8 Verifiable certificates (HMAC)
At check-in we compute `cert_id = first 12 hex chars of HMAC-SHA256(secret, ticket_code)` and store it. The PDF (made with `pdfkit`) includes a QR code pointing to `/verify/<cert_id>`. That page asks the public endpoint `GET /api/verify/:certId`, which looks the ID up and returns the name and event.

Why this is sound: the ID is derived from a server secret, so you cannot invent a valid one; and it is only created at check-in, so it proves attendance. Honest limitation: 48 bits of ID is fine for a college project, but a production system would use longer IDs and rate-limit the verify endpoint.

### 3.9 Real-time updates: Server-Sent Events (SSE)
The Live stats tab opens `new EventSource('/api/events/5/stream')`. The server keeps that HTTP response open and writes `data: {...}\n\n` whenever someone is checked in (via the in-process `bus`). The browser reacts by refetching analytics.

**SSE vs WebSocket** (expect this question):
- SSE is one-way (server to client), plain HTTP, auto-reconnects, and is enough for dashboards.
- WebSocket is two-way and better for chat or games. We do not need the extra complexity.

Detail: `EventSource` cannot set an `Authorization` header, so this one route accepts `?token=`. The downside is that the token can end up in server logs; mitigations are short-lived stream tokens or cookies.

Scaling note: the `bus` is in-memory, so it works for one server process. With multiple instances you replace it with **Redis pub/sub** so a check-in on instance A reaches dashboards connected to instance B.

### 3.10 Analytics in SQL
`GROUP BY` buckets check-ins into 15-minute slots with `strftime`, and registrations by day. Aggregation happens in the database, which is much faster than loading rows and counting in JavaScript.

### 3.11 Security checklist (what we did)
| Risk | Defense |
|---|---|
| SQL injection | Parameterized queries everywhere, never string concatenation of user input |
| Brute-force login | `express-rate-limit` on `/api/auth` |
| Bad input | zod validation, DB `CHECK` constraints |
| Header attacks / XSS surface | `helmet` with a Content-Security-Policy; React escapes output by default |
| Broken access control | Role checks plus ownership checks on every organizer route |
| Weak secrets | Server refuses to start in production without `JWT_SECRET` |
| Password leaks | bcrypt hashes; the hash is never sent to the client |

### 3.12 Frontend concepts used
- **SPA routing:** React Router changes the view without page reloads; the server returns `index.html` for unknown non-API paths so deep links work.
- **State:** `useState` for local state, `useContext` for the signed-in user (`AuthProvider`), `useEffect` to load data, `useCallback` to keep functions stable for effect dependencies.
- **Route guards:** `Guard` redirects anonymous users and wrong roles.
- **Code splitting:** `html5-qrcode` is loaded with a dynamic `import()` only when someone taps "Scan with camera", keeping the main bundle small.
- **Debounce on scan:** a camera fires many times a second, so the check-in screen ignores the same code for 3 seconds.
- **Dev proxy:** Vite proxies `/api` to port 4000, so the browser sees one origin and CORS is never needed.
- **Accessibility basics:** labelled inputs, visible focus, `role="alert"/"status"` for messages, reduced-motion support.

---

## 4. Request flows (trace these out loud in an interview)

**Register for an event**
1. Student clicks Register, so `api('/events/5/register', POST)` runs with the JWT.
2. `auth` verifies the token; `requireRole('student')` passes.
3. `registerTx` (one transaction): event exists, has not started, count < capacity, insert with a random ticket code. A unique violation becomes "already registered".
4. UI reloads the event and shows "View my ticket".

**Door check-in**
1. Organizer scans; the browser sends `POST /events/5/checkin {code}`.
2. `ownEvent` confirms this is their event. The code is cleaned (`PL:` removed) and looked up by `(event_id, ticket_code)`.
3. Atomic `UPDATE ... WHERE checked_in_at IS NULL` sets the time and certificate ID.
4. Server emits on the bus; every open Live stats tab receives the SSE message and refetches.
5. Result banner: green (ok), yellow (already), red (invalid).

**Certificate**
1. Student, after check-in, clicks Download certificate.
2. Server refuses with 403 if not checked in; otherwise streams a PDF.
3. Anyone scanning the QR lands on `/verify/<id>` and sees the verified name and event.

---

## 5. API reference

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/auth/register`, `/login` | public | Create account, sign in |
| `GET /api/auth/me` | any | Current user |
| `GET /api/events`, `/events/:id` | public | Browse |
| `GET /api/organizer/events` | organizer | My events |
| `POST /api/events` | organizer | Create |
| `PUT/DELETE /api/events/:id` | owner | Edit (capacity cannot drop below registered count), delete |
| `POST/DELETE /api/events/:id/register` | student | Register, cancel (not after check-in) |
| `GET /api/me/tickets` | student | Tickets with QR images |
| `GET /api/events/:id/mine` | any | My registration and volunteer state |
| `POST /api/events/:id/checkin` | owner | Check a ticket in |
| `GET /api/events/:id/attendees` | owner | Attendee list |
| `GET /api/events/:id/analytics` | owner | Totals, 15-min slots, registrations per day |
| `GET /api/events/:id/stream?token=` | owner | SSE live updates |
| `GET /api/events/:id/certificate` | student | PDF, only after check-in |
| `GET /api/verify/:certId` | public | Verify a certificate |
| `POST/DELETE /api/events/:id/volunteer` | student | Join or leave volunteer team |
| `GET /api/events/:id/volunteers` | owner | Volunteer list |
| `GET/POST /api/events/:id/tasks` | owner or volunteer / owner | List, create |
| `PATCH/DELETE /api/tasks/:id` | owner or assignee / owner | Update, delete |

---

## 6. What is tested and what is not

**Tested automatically (`npm test`, 10 groups of checks):** signup, duplicate email, bad login; role checks and validation; duplicate registration and capacity limit; QR ticket generation; check-in success, invalid code and duplicate scan; analytics counts and access control; certificate is a real PDF and verifies publicly; no certificate before check-in; task assignment rules and volunteer permissions.

**Verified manually:** the React app builds, and the single server serves the API, the SPA and deep links.

**Not tested yet, so check these yourself before you demo:**
- The **camera scanner** (`html5-qrcode`) needs a real device camera and HTTPS or localhost. USB scanners and pasted codes use the same endpoint and are covered by the API test.
- A full click-through of the UI in a browser. There are no automated frontend tests yet.
- Behavior under heavy concurrent load.

---

## 7. Interview questions and strong answers

**Q: Walk me through the architecture.** Use the diagram in section 2 and name the layers: transport, auth, validation, data access, side effects.

**Q: How do you prevent overbooking?** Section 3.6: transaction around count-and-insert, plus a database unique constraint as the last line of defense.

**Q: What if two volunteers scan the same ticket at once?** The `UPDATE ... WHERE checked_in_at IS NULL` statement is atomic, so exactly one succeeds.

**Q: Why JWT and not sessions?** Stateless, simple to scale. Then volunteer the weaknesses: no easy revocation, `localStorage` exposure to XSS, and how you would harden it (HttpOnly cookies, refresh tokens).

**Q: Why SSE instead of WebSockets?** One-way data, plain HTTP, built-in reconnect. Switch to WebSockets if the browser needs to send frequent messages.

**Q: How would this scale to 50,000 users?** Move SQLite to PostgreSQL; run several API instances behind a load balancer; replace the in-memory bus with Redis pub/sub; cache the public event list in Redis; add read indexes; move PDF generation to a background queue.

**Q: What would you do differently with more time?** Email tickets, payments, waitlists, offline-capable check-in (service worker plus sync), refresh tokens, automated browser tests, Docker plus CI/CD, rate-limit the verify endpoint.

**Q: How do you stop someone forging a ticket or certificate?** Random 96-bit ticket codes; certificate IDs derived with HMAC from a server secret.

**Q: What is an IDOR and where could it appear here?** Changing an ID in the URL to reach someone else's data. `ownEvent` and the task permission checks prevent it.

---

## 8. How to describe it on your resume

Use only what is true. Replace the bracketed parts with your real facts, and **do not invent numbers**.

- Built a full-stack event platform (React, Node.js/Express, SQL) with role-based access for attendees and organizers, QR-code ticketing and door check-in.
- Prevented overbooking and duplicate check-ins with transactional registration and atomic compare-and-set updates; covered the API with end-to-end tests.
- Implemented live attendance analytics with Server-Sent Events and SQL aggregation, plus verifiable PDF certificates signed with HMAC.
- Secured the API with bcrypt, JWT, input validation (zod), rate limiting, CSP headers and ownership checks.
- [Only if true] Deployed at [event name] with [number] real registrations.

The last bullet is the strongest one you can add. Running it at one real college event turns a project into proof.

---

## 9. Next steps that raise the value the most

1. **Deploy it** (Render, Railway or Fly.io) and put the live link on your resume.
2. **Move to PostgreSQL** and add a `docker-compose.yml` (API plus database).
3. **Add GitHub Actions** to run `npm test` on every push.
4. **Run it at a real college event** and note the real numbers.
5. Add email tickets (Resend or Nodemailer) and a browser end-to-end test (Playwright).
