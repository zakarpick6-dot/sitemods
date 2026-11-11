'use strict';

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');

const config = require('./config');
const { get } = require('./db');
const { HttpError, sendJson, sendText, sendBuffer, readJson, parseQuery } = require('./http');
const {
  applySecurityHeaders,
  readAuth,
  assertCsrf,
  getVisitor,
  appendCookie,
  clientIp,
  RateLimiter,
} = require('./security');
const { serveFile, resolveInside, MIME } = require('./static');
const { dropBySlug } = require('./routes/public');
const { metaBlock, injectHead, sitemapXml, robotsTxt, truncate } = require('./render');
const { recordClick } = require('./stats');

const publicRoutes = require('./routes/public').routes;
const authRoutes = require('./routes/auth').routes;
const adminRoutes = require('./routes/admin').routes;
const routes = [...authRoutes, ...adminRoutes, ...publicRoutes];

const apiLimiter = new RateLimiter({ limit: 300, windowMs: 60_000, name: 'api' });
const trackLimiter = new RateLimiter({ limit: 90, windowMs: 60_000, name: 'track' });
const goLimiter = new RateLimiter({ limit: 60, windowMs: 60_000, name: 'go' });

const MIME_WHITELIST = new Set([
  '.css',
  '.js',
  '.mjs',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.woff2',
  '.woff',
  '.webmanifest',
  '.txt',
  '.json',
]);

function baseUrl(req) {
  const proto = config.COOKIE_SECURE ? 'https' : 'http';
  return `${proto}://${req.headers.host || `localhost:${config.PORT}`}`;
}

function checkOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  if (origin === 'null') throw new HttpError(403, 'Request origin is not allowed.', { code: 'bad_origin' });
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.', { code: 'bad_origin' });
  }
  const allowedHosts = new Set([req.headers.host, new URL(config.APP_URL).host].filter(Boolean));
  if (!allowedHosts.has(host)) {
    throw new HttpError(403, 'Request origin is not allowed.', { code: 'bad_origin' });
  }
}

async function servePage(req, res, file, { meta, status = 200, noindex = false } = {}) {
  let html;
  try {
    html = await fsp.readFile(file, 'utf8');
  } catch {
    return send404(res, req);
  }
  if (meta) html = injectHead(html, meta);
  if (noindex) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return sendBuffer(req, res, status, Buffer.from(html, 'utf8'), {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
}

function send404(req, res) {
  return servePage(req, res, path.join(config.PUBLIC_DIR, '404.html'), { status: 404 });
}

function handleError(req, res, error) {
  if (res.headersSent) {
    try {
      res.destroy();
    } catch {
      /* noop */
    }
    return;
  }
  const isApi = String(req.url || '').startsWith('/api/');
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) {
    console.error('[error]', req.method, req.url, error);
  }
  if (error.retryAfter) {
    res.setHeader('Retry-After', String(error.retryAfter));
  }
  const payload = {
    error: {
      message:
        status >= 500
          ? 'Something went wrong on our side. Please try again.'
          : error.message || 'Request failed.',
      code: error.code || 'error',
      ...(error.field ? { field: error.field } : {}),
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    },
  };
  if (isApi) sendJson(req, res, status, payload);
  else sendText(req, res, status, payload.error.message);
}

async function handleApi(req, res, url) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const pathname = url.pathname;

  const general = apiLimiter.check(clientIp(req));
  if (!general.ok) {
    res.setHeader('Retry-After', String(general.retryAfter));
    throw new HttpError(429, 'Too many requests. Slow down a little.', {
      code: 'rate_limited',
      retryAfter: general.retryAfter,
    });
  }
  if (
    pathname === '/api/visit' ||
    pathname.endsWith('/view') ||
    pathname.endsWith('/click')
  ) {
    const track = trackLimiter.check(`${clientIp(req)}:${pathname.startsWith('/api/visit') ? 'visit' : 'drop'}`);
    if (!track.ok) {
      throw new HttpError(429, 'Too many requests. Try again shortly.', {
        code: 'rate_limited',
        retryAfter: track.retryAfter,
      });
    }
  }

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;

    const ctx = {
      req,
      res,
      url,
      query: parseQuery(url),
      ip: clientIp(req),
      auth: null,
      body: null,
      json: (status, data, headers) => sendJson(req, res, status, data, headers),
    };

    if (route.auth) {
      const auth = readAuth(req);
      if (!auth) {
        throw new HttpError(401, 'Authentication required.', { code: 'unauthenticated' });
      }
      ctx.auth = auth;
      if (route.csrf && req.method !== 'GET' && !assertCsrf(auth, req)) {
        throw new HttpError(403, 'Security token expired. Refresh the page and try again.', {
          code: 'csrf_failed',
        });
      }
    }

    if (route.bodyLimit && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      const length = Number(req.headers['content-length'] || 0);
      if (length > 0 || req.headers['content-type']) {
        ctx.body = await readJson(req, route.bodyLimit);
      } else if (route.requiresBody) {
        throw new HttpError(400, 'Request body is required.', { code: 'empty_body' });
      } else {
        ctx.body = {};
      }
    }

    const started = Date.now();
    await route.handler(ctx, ...match.slice(1));
    const ms = Date.now() - started;
    if (ms > 800) console.warn(`[slow] ${req.method} ${pathname} ${ms}ms`);
    return;
  }

  throw new HttpError(404, 'API endpoint not found.', { code: 'not_found' });
}

async function handleRequest(req, res) {
  const nonce = crypto.randomBytes(16).toString('base64');
  applySecurityHeaders(res, nonce);

  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD, POST, PATCH, DELETE');
    throw new HttpError(405, 'Method not allowed.', { code: 'method_not_allowed' });
  }

  const url = new URL(req.url, 'http://internal.local');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Malformed URL.', { code: 'bad_request' });
  }

  checkOrigin(req);

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  /* ----------------------------- pages ----------------------------- */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.', { code: 'method_not_allowed' });
  }

  if (pathname === '/' || pathname === '/index.html') {
    if (pathname === '/index.html') {
      res.writeHead(301, { Location: '/' });
      return res.end();
    }
    return servePage(req, res, path.join(config.PUBLIC_DIR, 'index.html'));
  }

  if (pathname === '/sitemap.xml') {
    return sendBuffer(req, res, 200, Buffer.from(sitemapXml(), 'utf8'), {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    });
  }

  if (pathname === '/robots.txt') {
    return sendText(req, res, 200, robotsTxt(), {
      'Cache-Control': 'public, max-age=1800',
    });
  }

  if (pathname === '/favicon.ico') {
    return serveFile(req, res, path.join(config.PUBLIC_DIR, 'assets/brand/favicon.png'), {
      cacheControl: 'public, max-age=604800',
    });
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    const auth = readAuth(req);
    if (!auth) {
      res.writeHead(302, { Location: '/admin/login' });
      return res.end();
    }
    return servePage(req, res, path.join(config.PUBLIC_DIR, 'admin.html'), {
      noindex: true,
    });
  }

  if (pathname === '/admin/login' || pathname === '/admin/login/') {
    if (readAuth(req)) {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
    return servePage(req, res, path.join(config.PUBLIC_DIR, 'login.html'), {
      noindex: true,
    });
  }

  if (pathname === '/login') {
    res.writeHead(301, { Location: '/admin/login' });
    return res.end();
  }

  if (pathname.startsWith('/admin/')) {
    res.writeHead(301, { Location: '/admin' });
    return res.end();
  }

  /* ---------------------------- categories ---------------------------- */
  const categoryMatch = /^\/category\/([a-z0-9-]{1,60})\/?$/.exec(pathname);
  if (categoryMatch) {
    const category = get('SELECT * FROM categories WHERE slug = ?', categoryMatch[1]);
    if (!category) return send404(req, res);
    const meta = metaBlock({
      title: `${category.name} Drops`,
      description: `${category.description} Explore ${category.name} drops on REVOMAKER STEAM.`,
      canonical: `/category/${category.slug}`,
      nonce,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${category.name} Drops`,
        description: category.description,
        url: `${config.APP_URL}/category/${category.slug}`,
      },
    });
    return servePage(req, res, path.join(config.PUBLIC_DIR, 'category.html'), { meta });
  }

  /* ------------------------------ drops ------------------------------ */
  const dropMatch = /^\/drop\/([a-z0-9-]{1,80})\/?$/.exec(pathname);
  if (dropMatch) {
    let drop;
    try {
      drop = dropBySlug(dropMatch[1]);
    } catch {
      return send404(req, res);
    }
    const image = drop.thumbnail?.startsWith('/uploads/')
      ? drop.thumbnail
      : '/assets/brand/og-cover.png';
    const meta = metaBlock({
      title: drop.title,
      description: drop.description,
      canonical: `/drop/${drop.slug}`,
      image,
      type: 'article',
      nonce,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: drop.title,
        description: truncate(drop.description, 300),
        url: `${config.APP_URL}/drop/${drop.slug}`,
        datePublished: drop.published_at,
        dateModified: drop.updated_at,
        image: `${config.APP_URL}${image}`,
        isPartOf: { '@type': 'WebSite', name: 'REVOMAKER STEAM', url: config.APP_URL },
      },
    });
    return servePage(req, res, path.join(config.PUBLIC_DIR, 'drop.html'), { meta });
  }

  /* ------------------------------ /go ------------------------------ */
  const goMatch = /^\/go\/([a-z0-9-]{1,80})\/?$/.exec(pathname);
  if (goMatch) {
    const limited = goLimiter.check(clientIp(req));
    if (!limited.ok) {
      return send404(req, res);
    }
    let drop;
    try {
      drop = dropBySlug(goMatch[1]);
    } catch {
      return send404(req, res);
    }
    const visitor = getVisitor(req);
    if (visitor.cookie) appendCookie(res, visitor.cookie);
    recordClick(drop, visitor.id);
    res.writeHead(302, {
      Location: drop.external_url,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    return res.end();
  }

  /* ---------------------------- uploads ---------------------------- */
  const uploadMatch = /^\/uploads\/([a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif))$/i.exec(pathname);
  if (uploadMatch) {
    const file = path.join(config.UPLOAD_DIR, uploadMatch[1]);
    const served = await serveFile(req, res, file, {
      cacheControl: 'public, max-age=31536000, immutable',
      headers: {
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
    if (!served) return send404(req, res);
    return;
  }

  /* --------------------------- static files --------------------------- */
  const file = resolveInside(config.PUBLIC_DIR, pathname);
  if (!file) return send404(req, res);
  const ext = path.extname(file).toLowerCase();
  if (!MIME_WHITELIST.has(ext)) return send404(req, res);
  const cacheControl = pathname.startsWith('/assets/')
    ? 'public, max-age=604800'
    : 'public, max-age=0, must-revalidate';
  const served = await serveFile(req, res, file, { cacheControl });
  if (!served) return send404(req, res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => handleError(req, res, error));
});

server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const cleanupTimer = setInterval(() => {
  try {
    require('./security').cleanupSessions();
  } catch (error) {
    console.error('[cleanup]', error.message);
  }
}, 60 * 60 * 1000);
cleanupTimer.unref();

server.listen(config.PORT, config.HOST, () => {
  const owners = get('SELECT COUNT(*) AS c FROM users').c;
  const line = '─'.repeat(52);
  console.log(`\n  REVOMAKER STEAM  ·  v${config.VERSION}`);
  console.log(`  ${line}`);
  console.log(`  Local     ${config.APP_URL}`);
  console.log(`  Admin     ${config.APP_URL}/admin/login`);
  console.log(`  Database  ${config.DB_PATH}`);
  console.log(`  Owners    ${owners}/${config.OWNER_LIMIT} configured`);
  if (owners === 0) {
    console.log('\n  ⚠  No owner accounts yet. Run:  npm run setup');
  }
  console.log(`  ${line}\n`);
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

module.exports = server;
