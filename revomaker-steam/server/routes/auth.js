'use strict';

const { HttpError } = require('../http');
const { get, run, nowIso } = require('../db');
const {
  verifyPassword,
  hashPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  revokeSession,
  revokeAllSessions,
  cleanupSessions,
  recordLoginAttempt,
  recentFailures,
  audit,
  randomHex,
  hashIp,
  RateLimiter,
} = require('../security');
const { validateEmail, validatePassword } = require('../validation');

// Constant-ish timing for unknown accounts.
const dummyHash = hashPassword(randomHex(18));

const loginLimiter = new RateLimiter({ limit: 12, windowMs: 15 * 60_000, name: 'login' });

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

const routes = [
  {
    method: 'POST',
    pattern: /^\/api\/auth\/login$/,
    bodyLimit: 8 * 1024,
    handler: async (ctx) => {
      const { email, password } = ctx.body || {};
      let normalizedEmail;
      try {
        normalizedEmail = validateEmail(email);
      } catch {
        throw new HttpError(401, 'Invalid email or password.', { code: 'invalid_credentials' });
      }
      if (typeof password !== 'string' || !password.length || password.length > 200) {
        throw new HttpError(401, 'Invalid email or password.', { code: 'invalid_credentials' });
      }

      const limiter = loginLimiter.check(ctx.ip);
      const failures = recentFailures(ctx.req, 15);
      if (!limiter.ok || failures >= 8) {
        const wait = limiter.retryAfter || 900;
        throw new HttpError(429, 'Too many sign-in attempts. Try again later.', {
          code: 'rate_limited',
          retryAfter: wait,
        });
      }

      const user = get('SELECT * FROM users WHERE email = ?', normalizedEmail);
      let valid = false;
      if (user) {
        valid = await verifyPassword(password, user.password_hash);
      } else {
        await verifyPassword(password, await dummyHash);
      }

      if (!user || !valid) {
        recordLoginAttempt(ctx.req, normalizedEmail, false);
        audit(null, 'login_failed', 'user', null, normalizedEmail, ctx.req);
        await new Promise((resolve) => setTimeout(resolve, 320));
        throw new HttpError(401, 'Invalid email or password.', { code: 'invalid_credentials' });
      }

      recordLoginAttempt(ctx.req, normalizedEmail, true);
      run('DELETE FROM auth_attempts WHERE success = 0 AND ip_hash = ?', hashIp(ctx.req));
      cleanupSessions();

      const session = createSession(user.id, ctx.req);
      run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
      setSessionCookie(ctx.res, session.token, session.maxAge);
      audit({ user }, 'login', 'user', user.id, 'Owner signed in', ctx.req);

      ctx.json(200, {
        ok: true,
        user: publicUser(user),
        csrfToken: session.csrf,
        expiresAt: session.expiresAt,
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/auth\/me$/,
    auth: true,
    handler: (ctx) =>
      ctx.json(200, {
        user: publicUser(ctx.auth.user),
        csrfToken: ctx.auth.csrfToken,
        expiresAt: ctx.auth.expiresAt,
      }),
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/logout$/,
    auth: true,
    csrf: true,
    bodyLimit: 2048,
    handler: (ctx) => {
      revokeSession(ctx.auth.tokenHash);
      clearSessionCookie(ctx.res);
      audit(ctx.auth, 'logout', 'user', ctx.auth.user.id, 'Owner signed out', ctx.req);
      ctx.json(200, { ok: true });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/password$/,
    auth: true,
    csrf: true,
    bodyLimit: 8 * 1024,
    handler: async (ctx) => {
      const { currentPassword, newPassword } = ctx.body || {};
      if (typeof currentPassword !== 'string') {
        throw new HttpError(422, 'Current password is required.', { field: 'currentPassword' });
      }
      const next = validatePassword(newPassword, { label: 'New password', min: 12 });
      const user = get('SELECT * FROM users WHERE id = ?', ctx.auth.user.id);
      const valid = await verifyPassword(currentPassword, user.password_hash);
      if (!valid) {
        throw new HttpError(422, 'Current password is incorrect.', { field: 'currentPassword' });
      }
      if (currentPassword === next) {
        throw new HttpError(422, 'Choose a password you have not used before.', {
          field: 'newPassword',
        });
      }
      const hash = await hashPassword(next);
      run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hash, nowIso(), user.id);
      revokeAllSessions(user.id, ctx.auth.sessionId);
      audit(ctx.auth, 'password_changed', 'user', user.id, 'Password rotated', ctx.req);
      ctx.json(200, { ok: true, message: 'Password updated. Other sessions were signed out.' });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/auth\/sessions$/,
    auth: true,
    handler: (ctx) => {
      const rows = require('../db').all(
        `SELECT id, created_at, expires_at, ip_hash, user_agent
           FROM sessions
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC`,
        ctx.auth.user.id,
        nowIso()
      );
      ctx.json(200, {
        sessions: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          current: row.id === ctx.auth.sessionId,
          device: /mobile|android|iphone/i.test(row.user_agent || '') ? 'Mobile' : 'Desktop',
          userAgent: row.user_agent,
        })),
      });
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/auth\/sessions\/(\d{1,12})$/,
    auth: true,
    csrf: true,
    handler: (ctx, idParam) => {
      const id = Number(idParam);
      const session = get(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
        id,
        ctx.auth.user.id
      );
      if (!session) throw new HttpError(404, 'Session not found.', { code: 'session_not_found' });
      run('UPDATE sessions SET revoked_at = ? WHERE id = ?', nowIso(), id);
      if (id === ctx.auth.sessionId) clearSessionCookie(ctx.res);
      audit(ctx.auth, 'session_revoked', 'session', id, 'Session revoked', ctx.req);
      ctx.json(200, { ok: true, current: id === ctx.auth.sessionId });
    },
  },
];

module.exports = { routes, publicUser };
