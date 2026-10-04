import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { auth, streamAuth, requireRole } from '../auth.js';
import { bus } from '../bus.js';

const r = Router();

const eventSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(2000).default(''),
  venue: z.string().trim().min(2).max(120),
  starts_at: z.string().datetime(),
  capacity: z.number().int().min(1).max(100000),
});

const LIST_SQL = `
  SELECT e.*, u.name AS organizer_name,
    (SELECT COUNT(*) FROM registrations g WHERE g.event_id = e.id) AS registered
  FROM events e JOIN users u ON u.id = e.organizer_id`;

// Loads the event and makes sure the signed-in organizer owns it.
export function ownEvent(req, res, next) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  if (ev.organizer_id !== req.user.id) return res.status(403).json({ error: 'This is not your event.' });
  req.event = ev;
  next();
}

r.get('/events', (_req, res) => {
  res.json(db.prepare(`${LIST_SQL} ORDER BY e.starts_at`).all());
});

r.get('/events/:id', (req, res) => {
  const ev = db.prepare(`${LIST_SQL} WHERE e.id = ?`).get(Number(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  res.json(ev);
});

r.get('/organizer/events', auth, requireRole('organizer'), (req, res) => {
  res.json(db.prepare(`${LIST_SQL} WHERE e.organizer_id = ? ORDER BY e.starts_at`).all(req.user.id));
});

r.post('/events', auth, requireRole('organizer'), (req, res) => {
  const d = eventSchema.parse(req.body);
  const id = db
    .prepare('INSERT INTO events (organizer_id, title, description, venue, starts_at, capacity) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, d.title, d.description, d.venue, d.starts_at, d.capacity).lastInsertRowid;
  res.status(201).json(db.prepare(`${LIST_SQL} WHERE e.id = ?`).get(id));
});

r.put('/events/:id', auth, requireRole('organizer'), ownEvent, (req, res) => {
  const d = eventSchema.parse(req.body);
  const { n } = db.prepare('SELECT COUNT(*) n FROM registrations WHERE event_id = ?').get(req.event.id);
  if (d.capacity < n) return res.status(409).json({ error: `Capacity cannot go below ${n} (already registered).` });
  db.prepare('UPDATE events SET title=?, description=?, venue=?, starts_at=?, capacity=? WHERE id=?').run(
    d.title, d.description, d.venue, d.starts_at, d.capacity, req.event.id,
  );
  res.json(db.prepare(`${LIST_SQL} WHERE e.id = ?`).get(req.event.id));
});

r.delete('/events/:id', auth, requireRole('organizer'), ownEvent, (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.event.id);
  res.status(204).end();
});

// ---- Organizer tools: attendees, analytics, live stream ----

r.get('/events/:id/attendees', auth, requireRole('organizer'), ownEvent, (req, res) => {
  res.json(
    db.prepare(
      `SELECT g.id, u.name, u.email, g.registered_at, g.checked_in_at
       FROM registrations g JOIN users u ON u.id = g.user_id
       WHERE g.event_id = ? ORDER BY g.registered_at`,
    ).all(req.event.id),
  );
});

r.get('/events/:id/analytics', auth, requireRole('organizer'), ownEvent, (req, res) => {
  const id = req.event.id;
  const totals = db
    .prepare('SELECT COUNT(*) AS registered, COUNT(checked_in_at) AS checked_in FROM registrations WHERE event_id = ?')
    .get(id);
  // Bucket check-ins into 15-minute slots for the bar chart.
  const checkinsBySlot = db
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:', checked_in_at) ||
              printf('%02d', (CAST(strftime('%M', checked_in_at) AS INTEGER) / 15) * 15) AS slot,
              COUNT(*) AS count
       FROM registrations WHERE event_id = ? AND checked_in_at IS NOT NULL
       GROUP BY slot ORDER BY slot`,
    ).all(id);
  const registrationsByDay = db
    .prepare(
      `SELECT substr(registered_at, 1, 10) AS day, COUNT(*) AS count
       FROM registrations WHERE event_id = ? GROUP BY day ORDER BY day`,
    ).all(id);
  const recent = db
    .prepare(
      `SELECT u.name, g.checked_in_at FROM registrations g JOIN users u ON u.id = g.user_id
       WHERE g.event_id = ? AND g.checked_in_at IS NOT NULL ORDER BY g.checked_in_at DESC LIMIT 8`,
    ).all(id);
  res.json({
    capacity: req.event.capacity,
    ...totals,
    not_checked_in: totals.registered - totals.checked_in,
    checkin_rate: totals.registered ? totals.checked_in / totals.registered : 0,
    checkinsBySlot,
    registrationsByDay,
    recent,
  });
});

// Server-Sent Events: the dashboard refetches analytics whenever a check-in happens.
r.get('/events/:id/stream', streamAuth, requireRole('organizer'), ownEvent, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const channel = `event:${req.event.id}`;
  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
  bus.on(channel, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    bus.off(channel, send);
    clearInterval(ping);
  });
  send({ type: 'hello' });
});

export default r;
