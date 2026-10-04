import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db.js';
import { auth, signToken } from '../auth.js';

const r = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  role: z.enum(['student', 'organizer']).default('student'),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

r.post('/register', (req, res) => {
  const d = registerSchema.parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) {
    return res.status(409).json({ error: 'That email is already registered.' });
  }
  const hash = bcrypt.hashSync(d.password, 10);
  const id = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(d.name, d.email, hash, d.role).lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

r.post('/login', (req, res) => {
  const d = loginSchema.parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(d.email);
  // Same message for unknown email and wrong password, so emails cannot be probed.
  if (!user || !bcrypt.compareSync(d.password, user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

r.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  res.json({ user: publicUser(user) });
});

export default r;
