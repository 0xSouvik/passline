import jwt from 'jsonwebtoken';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
export const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const signToken = (u) => jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '7d' });

function verify(token, req, res, next) {
  try {
    const p = jwt.verify(token || '', SECRET);
    req.user = { id: p.sub, role: p.role };
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again.' });
  }
}

export const auth = (req, res, next) => {
  const h = req.headers.authorization || '';
  verify(h.startsWith('Bearer ') ? h.slice(7) : '', req, res, next);
};

// EventSource cannot set headers, so the live stream accepts ?token= instead.
export const streamAuth = (req, res, next) => verify(String(req.query.token || ''), req, res, next);

export const requireRole = (role) => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: 'Your account cannot do that.' });
