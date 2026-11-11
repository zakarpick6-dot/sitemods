'use strict';

const zlib = require('node:zlib');

class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.status = status;
    this.code = options.code || 'error';
    this.field = options.field;
    this.retryAfter = options.retryAfter;
    this.details = options.details;
  }
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;

function sendBuffer(req, res, status, buffer, headers = {}) {
  const type = headers['Content-Type'] || 'application/octet-stream';
  let body = buffer;
  const accepts = String(req.headers['accept-encoding'] || '');
  if (buffer.length > 1024 && COMPRESSIBLE.test(type)) {
    try {
      if (/\bbr\b/.test(accepts)) {
        body = zlib.brotliCompressSync(buffer, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
          },
        });
        headers['Content-Encoding'] = 'br';
      } else if (/\bgzip\b/.test(accepts)) {
        body = zlib.gzipSync(buffer, { level: 6 });
        headers['Content-Encoding'] = 'gzip';
      }
      if (headers['Content-Encoding']) headers.Vary = 'Accept-Encoding';
    } catch {
      body = buffer;
    }
  }

  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || status === 204 || status === 304) {
    res.end();
  } else {
    res.end(body);
  }
}

function sendJson(req, res, status, data, headers = {}) {
  const payload = Buffer.from(JSON.stringify(data));
  sendBuffer(req, res, status, payload, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    ...headers,
  });
}

function sendText(req, res, status, text, headers = {}) {
  sendBuffer(req, res, status, Buffer.from(String(text)), {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > limit) {
      reject(new HttpError(413, 'Request body is too large.', { code: 'payload_too_large' }));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body is too large.', { code: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1024 * 1024) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Expected an application/json request body.', {
      code: 'unsupported_media_type',
    });
  }
  const raw = await readBody(req, limit);
  if (!raw.length) throw new HttpError(400, 'Request body is empty.', { code: 'empty_body' });
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Malformed JSON body.', { code: 'invalid_json' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object.', { code: 'invalid_json' });
  }
  return parsed;
}

function parseQuery(url) {
  const out = Object.create(null);
  for (const [key, value] of url.searchParams.entries()) {
    if (key.length > 60) continue;
    out[key] = value.length > 500 ? value.slice(0, 500) : value;
  }
  return out;
}

module.exports = {
  HttpError,
  sendJson,
  sendText,
  sendBuffer,
  readBody,
  readJson,
  parseQuery,
};
