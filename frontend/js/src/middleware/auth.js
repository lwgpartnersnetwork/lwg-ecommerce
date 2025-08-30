// middleware/auth.js
import jwt from 'jsonwebtoken';

/**
 * Middleware to protect admin routes with JWT Bearer token.
 * - Expects process.env.JWT_SECRET to be set
 * - Expects Authorization header in form: "Bearer <token>"
 * - Only allows payloads with { role: "admin" }
 */
export function requireAdmin(req, res, next) {
  if (!process.env.JWT_SECRET) {
    console.error('✖ JWT_SECRET not configured');
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  // Pull token from Authorization header
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const parts = String(authHeader).split(' ');
  const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : '';

  if (!token) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ ok: false, error: 'No token provided' });
  }

  try {
    // Verify token, allow small skew tolerance
    const payload = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 5 });

    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    // Attach minimal context
    req.user = {
      role: payload.role,
      sub: payload.sub,
      iat: payload.iat,
      exp: payload.exp,
    };

    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="expired"');
      return res.status(401).json({ ok: false, error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    console.error('JWT verify error:', err);
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}
