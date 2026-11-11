'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * Tiny .env loader (no dependencies)
 * ------------------------------------------------------------------ */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv(path.join(ROOT, '.env'));

const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ------------------------------------------------------------------ *
 * Persistent app secret (keeps visitor hashes + sessions coherent)
 * ------------------------------------------------------------------ */
function ensureSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.trim().length >= 32) {
    return process.env.APP_SECRET.trim();
  }
  const secretFile = path.join(DATA_DIR, '.secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* not created yet */
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const config = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR,
  UPLOAD_DIR,
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, 'revomaker.sqlite'),
  NODE_ENV,
  IS_PROD: NODE_ENV === 'production',
  PORT: Number.isFinite(PORT) ? PORT : 3000,
  HOST,
  APP_URL,
  SECRET: ensureSecret(),
  SESSION_DAYS: Number.parseInt(process.env.SESSION_DAYS || '7', 10) || 7,
  COOKIE_SECURE:
    process.env.COOKIE_SECURE === '1' || APP_URL.startsWith('https://'),
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  UPLOAD_MAX: Number.parseInt(process.env.UPLOAD_MAX_BYTES || '4194304', 10) || 4194304,
  SEED_DEMO: process.env.SEED_DEMO !== '0',
  OWNER_LIMIT: 3,
  VERSION: '1.0.0',
  STARTED_AT: Date.now(),
};

module.exports = config;
