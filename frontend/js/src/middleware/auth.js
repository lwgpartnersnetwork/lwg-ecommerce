// middleware/auth.js
import jwt from 'jsonwebtoken';

export function requireAdmin(req, res, next) {
  // Ensure server configured correctly
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Accept standard "Authorization: Bearer <token>"
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const parts = authHeader.split(' ');
  const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : '';

  if (!token) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Verify token (defaults to HS256). Add a small clock tolerance for minor skew.
    const payload = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 5 });

    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Attach minimal user context for downstream handlers
    req.user = { role: payload.role, iat: payload.iat, exp: payload.exp, sub: payload.sub };
    return next();
  } catch (err) {
    // Distinguish common JWT errors
    if (err.name === 'TokenExpiredError') {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="expired"');
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('JWT verify error:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
