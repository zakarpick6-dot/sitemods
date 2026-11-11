'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;
const compressCache = new Map();
const MAX_CACHE_ENTRIES = 240;

function cacheKey(file, mtimeMs, encoding) {
  return `${file}|${mtimeMs}|${encoding}`;
}

function remember(key, value) {
  if (compressCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = compressCache.keys().next().value;
    compressCache.delete(oldest);
  }
  compressCache.set(key, value);
}

function etagFor(stat) {
  return `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
}

/**
 * Serves a file from disk with ETag + on-the-fly compression.
 * Returns false when the file does not exist (caller can render a 404).
 */
async function serveFile(req, res, filePath, options = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = options.contentType || MIME[ext] || 'application/octet-stream';
  const etag = etagFor(stat);
  const cacheControl =
    options.cacheControl ||
    (ext === '.html' ? 'no-cache' : 'public, max-age=0, must-revalidate');

  const baseHeaders = {
    'Content-Type': type,
    ETag: etag,
    'Cache-Control': cacheControl,
    ...(options.headers || {}),
  };

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.split(',').map((s) => s.trim()).includes(etag)) {
    res.writeHead(304, baseHeaders);
    res.end();
    return true;
  }

  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    return false;
  }

  const accepts = String(req.headers['accept-encoding'] || '');
  let body = data;
  let encoding = null;
  if (data.length > 1200 && COMPRESSIBLE.test(type)) {
    encoding = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
    if (encoding) {
      const key = cacheKey(filePath, stat.mtimeMs, encoding);
      const cached = compressCache.get(key);
      if (cached) {
        body = cached;
      } else {
        try {
          body =
            encoding === 'br'
              ? zlib.brotliCompressSync(data, {
                  params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
                  },
                })
              : zlib.gzipSync(data, { level: 6 });
          remember(key, body);
        } catch {
          body = data;
          encoding = null;
        }
      }
    }
  }

  const headers = { ...baseHeaders };
  if (encoding) {
    headers['Content-Encoding'] = encoding;
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(options.status || 200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
  return true;
}

/** Safely resolve a public URL path against a root directory (blocks traversal). */
function resolveInside(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) return null;
  const normalized = path.posix.normalize(`/${decoded}`).replace(/^(\.\.[/\\])+/, '');
  const target = path.resolve(root, `.${normalized}`);
  const base = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(base)) return null;
  return target;
}

module.exports = { serveFile, resolveInside, MIME, COMPRESSIBLE };
