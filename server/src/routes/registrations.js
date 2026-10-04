import { Router } from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import db from '../db.js';
import { auth, requireRole, SECRET } from '../auth.js';
import { bus } from '../bus.js';
import { ownEvent } from './events.js';

const r = Router();
const PREFIX = 'PL:';

// better-sqlite3 transactions are synchronous, so the capacity check and the insert
// can never interleave with another request. In PostgreSQL use SELECT ... FOR UPDATE.
const registerTx = db.transaction((eventId, userId) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!ev) return { status: 404, error: 'Event not found.' };
  if (new Date(ev.starts_at) < new Date()) return { status: 409, error: 'Registration closed: this event has started.' };
  const { n } = db.prepare('SELECT COUNT(*) n FROM registrations WHERE event_id = ?').get(eventId);
  if (n >= ev.capacity) return { status: 409, error: 'This event is full.' };
  const code = crypto.randomBytes(12).toString('base64url'); // 96 bits: unguessable
  try {
    db.prepare('INSERT INTO registrations (event_id, user_id, ticket_code) VALUES (?,?,?)').run(eventId, userId, code);
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return { status: 409, error: 'You are already registered.' };
    throw e;
  }
  return { status: 201 };
});

r.post('/events/:id/register', auth, requireRole('student'), (req, res) => {
  const out = registerTx(Number(req.params.id), req.user.id);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.status(201).json({ ok: true });
});

r.delete('/events/:id/register', auth, requireRole('student'), (req, res) => {
  const info = db
    .prepare('DELETE FROM registrations WHERE event_id = ? AND user_id = ? AND checked_in_at IS NULL')
    .run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(409).json({ error: 'No cancellable registration found.' });
  res.status(204).end();
});

// My tickets, each with a QR code (PNG data URL) the organizer scans at the door.
r.get('/me/tickets', auth, requireRole('student'), async (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.event_id, g.ticket_code, g.checked_in_at, e.title, e.venue, e.starts_at
       FROM registrations g JOIN events e ON e.id = g.event_id
       WHERE g.user_id = ? ORDER BY e.starts_at`,
    ).all(req.user.id);
  const tickets = await Promise.all(
    rows.map(async (t) => ({
      event_id: t.event_id,
      title: t.title,
      venue: t.venue,
      starts_at: t.starts_at,
      checked_in_at: t.checked_in_at,
      qr: await QRCode.toDataURL(PREFIX + t.ticket_code, { margin: 1, width: 240 }),
    })),
  );
  res.json(tickets);
});

// Registration state for one event (used by the event page).
r.get('/events/:id/mine', auth, (req, res) => {
  const id = Number(req.params.id);
  const reg = db
    .prepare('SELECT checked_in_at FROM registrations WHERE event_id = ? AND user_id = ?')
    .get(id, req.user.id);
  const vol = db.prepare('SELECT 1 FROM volunteers WHERE event_id = ? AND user_id = ?').get(id, req.user.id);
  res.json({ registered: !!reg, checked_in: !!reg?.checked_in_at, volunteer: !!vol });
});

// ---- Check-in ----
r.post('/events/:id/checkin', auth, requireRole('organizer'), ownEvent, (req, res) => {
  const { code } = z.object({ code: z.string().min(4).max(100) }).parse(req.body);
  const clean = code.trim().replace(new RegExp(`^${PREFIX}`), '');
  const reg = db
    .prepare(
      `SELECT g.id, g.checked_in_at, u.name FROM registrations g JOIN users u ON u.id = g.user_id
       WHERE g.event_id = ? AND g.ticket_code = ?`,
    ).get(req.event.id, clean);
  if (!reg) return res.status(404).json({ result: 'invalid', error: 'No ticket like this for this event.' });

  const now = new Date().toISOString();
  // Certificate ID = HMAC of the ticket code: unforgeable without the server secret.
  const certId = crypto.createHmac('sha256', SECRET).update(clean).digest('hex').slice(0, 12).toUpperCase();
  // The "AND checked_in_at IS NULL" guard makes check-in atomic: a ticket scanned
  // twice at the same instant can only succeed once.
  const info = db
    .prepare('UPDATE registrations SET checked_in_at = ?, cert_id = ? WHERE id = ? AND checked_in_at IS NULL')
    .run(now, certId, reg.id);
  if (!info.changes) {
    return res.status(409).json({ result: 'already', name: reg.name, checked_in_at: reg.checked_in_at });
  }
  bus.emit(`event:${req.event.id}`, { type: 'checkin', name: reg.name, at: now });
  res.json({ result: 'ok', name: reg.name });
});

// ---- Certificates ----
r.get('/events/:id/certificate', auth, requireRole('student'), async (req, res) => {
  const row = db
    .prepare(
      `SELECT g.cert_id, g.checked_in_at, e.title, e.starts_at, e.venue, u.name
       FROM registrations g JOIN events e ON e.id = g.event_id JOIN users u ON u.id = g.user_id
       WHERE g.event_id = ? AND g.user_id = ?`,
    ).get(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: 'You are not registered for this event.' });
  if (!row.checked_in_at) return res.status(403).json({ error: 'Certificates are issued after you check in at the event.' });

  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const verifyUrl = `${base}/verify/${row.cert_id}`;
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 160 });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="certificate.pdf"' });
  doc.pipe(res);
  const W = doc.page.width, H = doc.page.height;
  doc.rect(24, 24, W - 48, H - 48).lineWidth(3).stroke('#1E1B4B');
  doc.rect(34, 34, W - 68, H - 68).lineWidth(1).stroke('#F5B301');
  doc.fillColor('#1E1B4B').font('Helvetica-Bold').fontSize(34).text('Certificate of Participation', 0, 110, { align: 'center' });
  doc.font('Helvetica').fontSize(14).fillColor('#5B5F7A').text('This certifies that', 0, 180, { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(40).fillColor('#1E1B4B').text(row.name, 0, 208, { align: 'center' });
  doc.font('Helvetica').fontSize(14).fillColor('#5B5F7A').text('attended', 0, 272, { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#1E1B4B').text(row.title, 60, 300, { align: 'center', width: W - 120 });
  const when = new Date(row.starts_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.font('Helvetica').fontSize(13).fillColor('#5B5F7A').text(`${row.venue}  |  ${when}`, 0, 350, { align: 'center' });
  doc.image(qr, 60, H - 150, { width: 80 });
  doc.fontSize(9).fillColor('#5B5F7A').text(`Certificate ID ${row.cert_id}`, 150, H - 120);
  doc.text('Scan the code to verify this certificate.', 150, H - 106);
  doc.end();
});

// Public: anyone can verify a certificate ID (e.g. a recruiter scanning the QR).
r.get('/verify/:certId', (req, res) => {
  const row = db
    .prepare(
      `SELECT u.name, e.title, e.starts_at FROM registrations g
       JOIN users u ON u.id = g.user_id JOIN events e ON e.id = g.event_id
       WHERE g.cert_id = ?`,
    ).get(String(req.params.certId).toUpperCase());
  if (!row) return res.status(404).json({ valid: false });
  res.json({ valid: true, name: row.name, title: row.title, starts_at: row.starts_at });
});

export default r;
