import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import registrationRoutes from './routes/registrations.js';
import taskRoutes from './routes/tasks.js';

export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'", 'blob:'],
      },
    },
  }),
);
app.use(express.json({ limit: '100kb' }));

// Brute-force protection for login and signup.
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 10000 : 100 }), authRoutes);
app.use('/api', eventRoutes, registrationRoutes, taskRoutes);

// Serve the built React app from the same server (one deployable unit).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) app.use(express.static(dist));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  const index = path.join(dist, 'index.html');
  return fs.existsSync(index) ? res.sendFile(index) : res.status(404).send('Build the client first: npm run build in /client');
});

// Central error handler: validation errors become friendly 400s, the rest are 500s.
app.use((err, _req, res, _next) => {
  if (err?.name === 'ZodError') {
    const i = err.issues[0];
    return res.status(400).json({ error: `${i.path.join('.') || 'input'}: ${i.message}` });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});
