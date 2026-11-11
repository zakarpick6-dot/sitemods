'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');
const { run, get, nowIso } = require('./db');

const scryptAsync = promisify(crypto.scrypt);

const SESSION_COOKIE = 'rv_session';
const VISITOR_COOKIE = 'rv_vid';
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

/* ------------------------------------------------------------------ *
 * Hashing helpers
 * ------------------------------------------------------------------ */

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scryptAsync(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Request helpers
 * ------------------------------------------------------------------ */

function clientIp(req) {
  let ip = req.socket?.remoteAddress || '';
  if (config.TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      ip = forwarded.split(',')[0].trim();
    } else if (req.headers['cf-connecting-ip']) {
      ip = String(req.headers['cf-connecting-ip']);
    }
  }
  return ip || 'unknown';
}

const hashIp = (req) => sha256(`${config.SECRET}:ip:${clientIp(req)}`).slice(0, 32);
const hashVisitorId = (id) => sha256(`${config.SECRET}:visitor:${id}`).slice(0, 40);

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure ?? config.COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

function appendCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(current)) res.setHeader('Set-Cookie', [...current, cookie]);
  else res.setHeader('Set-Cookie', [String(current), cookie]);
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

function createSession(userId, req) {
  const token = randomToken(32);
  const csrf = randomHex(24);
  const created = new Date();
  const expires = new Date(created.getTime() + config.SESSION_DAYS * 86_400_000);
  run(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sha256(token),
    userId,
    csrf,
    created.toISOString(),
    expires.toISOString(),
    hashIp(req),
    String(req.headers['user-agent'] || '').slice(0, 280)
  );
  return { token, csrf, expiresAt: expires.toISOString(), maxAge: config.SESSION_DAYS * 86_400 };
}

function readAuth(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length < 20) return null;
  const row = get(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
            u.id AS user_id, u.name, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?`,
    sha256(token),
    nowIso()
  );
  if (!row) return null;
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
    user: { id: row.user_id, name: row.name, email: row.email, role: row.role },
    tokenHash: sha256(token),
  };
}

function revokeSession(tokenHash) {
  if (!tokenHash) return;
  run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', nowIso(), tokenHash);
}

function revokeAllSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    run(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      nowIso(),
      userId,
      exceptSessionId
    );
  } else {
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);
  }
}

function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL', nowIso());
  run("DELETE FROM auth_attempts WHERE created_at < datetime('now', '-7 days')");
}

function setSessionCookie(res, token, maxAge) {
  appendCookie(
    res,
    serializeCookie(SESSION_COOKIE, token, { maxAge, httpOnly: true, sameSite: 'Lax' })
  );
}

function clearSessionCookie(res) {
  appendCookie(
    res,
    serializeCookie(SESSION_COOKIE, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' })
  );
}

function assertCsrf(auth, req) {
  if (!auth) return false;
  const provided = req.headers['x-csrf-token'];
  if (typeof provided !== 'string' || provided.length < 16) return false;
  return safeEqual(provided, auth.csrfToken);
}

/* ------------------------------------------------------------------ *
 * Visitor identity (privacy preserving: cookie id is hashed server-side)
 * ------------------------------------------------------------------ */

function getVisitor(req) {
  const existing = parseCookies(req)[VISITOR_COOKIE];
  if (existing && /^[a-f0-9]{32,64}$/i.test(existing)) {
    return { id: hashVisitorId(existing), isNew: false, cookie: null };
  }
  const fresh = randomHex(24);
  return {
    id: hashVisitorId(fresh),
    isNew: true,
    cookie: serializeCookie(VISITOR_COOKIE, fresh, {
      maxAge: 365 * 86_400,
      httpOnly: true,
      sameSite: 'Lax',
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Audit + login throttling
 * ------------------------------------------------------------------ */

function audit(auth, action, entity, entityId, detail, req) {
  try {
    run(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      auth?.user?.id ?? null,
      action,
      entity ?? null,
      entityId ?? null,
      detail ? String(detail).slice(0, 500) : null,
      req ? hashIp(req) : null,
      nowIso()
    );
  } catch {
    /* auditing must never break the request */
  }
}

function recordLoginAttempt(req, email, success) {
  run(
    `INSERT INTO auth_attempts (ip_hash, email_hash, success, created_at) VALUES (?, ?, ?, ?)`,
    hashIp(req),
    email ? sha256(String(email).toLowerCase()).slice(0, 24) : null,
    success ? 1 : 0,
    nowIso()
  );
}

function recentFailures(req, windowMinutes = 15) {
  const row = get(
    `SELECT COUNT(*) AS c FROM auth_attempts
      WHERE ip_hash = ? AND success = 0 AND created_at > datetime('now', ?)`,
    hashIp(req),
    `-${windowMinutes} minutes`
  );
  return row?.c || 0;
}

/* ------------------------------------------------------------------ *
 * Rate limiting (in-memory sliding window)
 * ------------------------------------------------------------------ */

class RateLimiter {
  constructor({ limit, windowMs, name = 'rl' }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.name = name;
    this.buckets = new Map();
    this.lastSweep = Date.now();
  }

  check(key) {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      for (const [k, v] of this.buckets) {
        if (!v.length || now - v[v.length - 1] > this.windowMs) this.buckets.delete(k);
      }
      this.lastSweep = now;
    }
    const bucketKey = `${this.name}:${key}`;
    let hits = this.buckets.get(bucketKey);
    if (!hits) {
      hits = [];
      this.buckets.set(bucketKey, hits);
    }
    while (hits.length && now - hits[0] > this.windowMs) hits.shift();
    if (hits.length >= this.limit) {
      const retryAfter = Math.max(1, Math.ceil((this.windowMs - (now - hits[0])) / 1000));
      return { ok: false, remaining: 0, retryAfter };
    }
    hits.push(now);
    return { ok: true, remaining: this.limit - hits.length, retryAfter: 0 };
  }
}

/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */

function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

function applySecurityHeaders(res, nonce) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', buildCsp(nonce));
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (config.COOKIE_SECURE) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

module.exports = {
  SESSION_COOKIE,
  VISITOR_COOKIE,
  sha256,
  safeEqual,
  hashPassword,
  verifyPassword,
  randomToken,
  randomHex,
  clientIp,
  hashIp,
  hashVisitorId,
  parseCookies,
  serializeCookie,
  appendCookie,
  createSession,
  readAuth,
  revokeSession,
  revokeAllSessions,
  cleanupSessions,
  setSessionCookie,
  clearSessionCookie,
  assertCsrf,
  getVisitor,
  audit,
  recordLoginAttempt,
  recentFailures,
  RateLimiter,
  applySecurityHeaders,
};
