'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { HttpError } = require('./http');

const ALLOWED = [
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => b.length > 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a'),
  },
];

function sniff(buffer) {
  return ALLOWED.find((entry) => entry.test(buffer)) || null;
}

function saveDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new HttpError(422, 'Thumbnail must be an uploaded image.', { field: 'thumbnail' });
  }
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) {
    throw new HttpError(422, 'Only PNG, JPEG, WebP or GIF images are allowed.', { field: 'thumbnail' });
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  } catch {
    throw new HttpError(422, 'Could not decode the uploaded image.', { field: 'thumbnail' });
  }
  if (!buffer.length) throw new HttpError(422, 'The uploaded image is empty.', { field: 'thumbnail' });
  if (buffer.length > config.UPLOAD_MAX) {
    throw new HttpError(
      413,
      `Thumbnail is too large (${Math.ceil(config.UPLOAD_MAX / 1024 / 1024)} MB maximum).`,
      { field: 'thumbnail' }
    );
  }
  const kind = sniff(buffer);
  if (!kind) {
    throw new HttpError(422, 'File signature does not match a supported image format.', {
      field: 'thumbnail',
    });
  }
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(10).toString('hex')}.${kind.ext}`;
  const target = path.join(config.UPLOAD_DIR, name);
  fs.writeFileSync(target, buffer, { mode: 0o644 });
  return {
    url: `/uploads/${name}`,
    filePath: target,
    bytes: buffer.length,
    mime: kind.mime,
  };
}

function deleteUpload(url) {
  if (typeof url !== 'string') return;
  const match = /^\/uploads\/([a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif))$/i.exec(url);
  if (!match) return;
  const target = path.resolve(config.UPLOAD_DIR, match[1]);
  const root = path.resolve(config.UPLOAD_DIR) + path.sep;
  if (!target.startsWith(root)) return;
  try {
    fs.unlinkSync(target);
  } catch {
    /* file may already be gone */
  }
}

module.exports = { saveDataUrl, deleteUpload, sniff, ALLOWED };
