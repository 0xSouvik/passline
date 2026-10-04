import { Router } from 'express';
import { z } from 'zod';
import db from '../db.js';
import { auth, requireRole } from '../auth.js';
import { ownEvent } from './events.js';

const r = Router();
const STATUS = z.enum(['todo', 'doing', 'done']);

const isOwner = (eventId, userId) =>
  !!db.prepare('SELECT 1 FROM events WHERE id = ? AND organizer_id = ?').get(eventId, userId);
const isVolunteer = (eventId, userId) =>
  !!db.prepare('SELECT 1 FROM volunteers WHERE event_id = ? AND user_id = ?').get(eventId, userId);

r.post('/events/:id/volunteer', auth, requireRole('student'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id)) return res.status(404).json({ error: 'Event not found.' });
  db.prepare('INSERT OR IGNORE INTO volunteers (event_id, user_id) VALUES (?,?)').run(id, req.user.id);
  res.status(201).json({ ok: true });
});

r.delete('/events/:id/volunteer', auth, requireRole('student'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM volunteers WHERE event_id = ? AND user_id = ?').run(id, req.user.id);
  db.prepare('UPDATE tasks SET assignee_id = NULL WHERE event_id = ? AND assignee_id = ?').run(id, req.user.id);
  res.status(204).end();
});

r.get('/events/:id/volunteers', auth, requireRole('organizer'), ownEvent, (req, res) => {
  res.json(
    db.prepare(
      'SELECT u.id, u.name, u.email FROM volunteers v JOIN users u ON u.id = v.user_id WHERE v.event_id = ? ORDER BY u.name',
    ).all(req.event.id),
  );
});

const TASKS_SQL = `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id`;

r.get('/events/:id/tasks', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!isOwner(id, req.user.id) && !isVolunteer(id, req.user.id)) {
    return res.status(403).json({ error: 'Only the organizer and volunteers can see tasks.' });
  }
  res.json(db.prepare(`${TASKS_SQL} WHERE t.event_id = ? ORDER BY t.id`).all(id));
});

const createSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(1000).default(''),
  assignee_id: z.number().int().nullable().default(null),
});

r.post('/events/:id/tasks', auth, requireRole('organizer'), ownEvent, (req, res) => {
  const d = createSchema.parse(req.body);
  if (d.assignee_id && !isVolunteer(req.event.id, d.assignee_id)) {
    return res.status(400).json({ error: 'Assignee must be a volunteer for this event.' });
  }
  const id = db
    .prepare('INSERT INTO tasks (event_id, title, description, assignee_id) VALUES (?,?,?,?)')
    .run(req.event.id, d.title, d.description, d.assignee_id).lastInsertRowid;
  res.status(201).json(db.prepare(`${TASKS_SQL} WHERE t.id = ?`).get(id));
});

// Organizer can change anything; the assignee can only move their own task between columns.
r.patch('/tasks/:taskId', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.taskId));
  if (!t) return res.status(404).json({ error: 'Task not found.' });
  const owner = isOwner(t.event_id, req.user.id);
  const assignee = t.assignee_id === req.user.id;
  if (!owner && !assignee) return res.status(403).json({ error: 'You cannot change this task.' });

  const d = z
    .object({ status: STATUS.optional(), assignee_id: z.number().int().nullable().optional(), title: z.string().trim().min(2).max(120).optional() })
    .parse(req.body);
  if (!owner && (d.assignee_id !== undefined || d.title !== undefined)) {
    return res.status(403).json({ error: 'Volunteers can only change the status.' });
  }
  if (d.assignee_id && !isVolunteer(t.event_id, d.assignee_id)) {
    return res.status(400).json({ error: 'Assignee must be a volunteer for this event.' });
  }
  const next = { ...t, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) };
  db.prepare('UPDATE tasks SET title = ?, status = ?, assignee_id = ? WHERE id = ?').run(
    next.title, next.status, next.assignee_id, t.id,
  );
  res.json(db.prepare(`${TASKS_SQL} WHERE t.id = ?`).get(t.id));
});

r.delete('/tasks/:taskId', auth, requireRole('organizer'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(req.params.taskId));
  if (!t || !isOwner(t.event_id, req.user.id)) return res.status(404).json({ error: 'Task not found.' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  res.status(204).end();
});

export default r;
