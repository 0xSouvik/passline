# Passline: campus event management platform

Registration, QR-code tickets, door check-in, live attendance stats, volunteer task board and verifiable PDF certificates.

**Stack:** React (Vite) | Node.js + Express | SQLite (better-sqlite3) | JWT auth | Server-Sent Events | pdfkit | qrcode

## Run it

```bash
# 1. install
cd server && npm install && cd ../client && npm install && cd ..

# 2. build the React app (the API server serves it)
cd client && npm run build && cd ..

# 3. seed demo data and start
cd server && npm run seed && npm start
# open http://localhost:4000
```

Demo logins (password `password123`): `organizer@demo.com`, `asha@demo.com`, `rohan@demo.com`.

**Development mode** (hot reload): run `npm run dev` in `server/` and `npm run dev` in `client/`, then open http://localhost:5173.

**Tests:** `cd server && npm test` runs an end-to-end API test against an in-memory database.

**Production:** set `JWT_SECRET` (the server refuses to start without it when `NODE_ENV=production`) and `PUBLIC_URL` (used inside certificate QR codes).

Read **NOTES.md** for how everything works, the concepts behind it, and interview preparation.
