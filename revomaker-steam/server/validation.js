'use strict';

const { HttpError } = require('./http');

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g;

function cleanText(value, { min = 0, max = 500, multiline = false, label = 'Field', required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return '';
    throw new HttpError(422, `${label} is required.`, { field: label.toLowerCase() });
  }
  if (typeof value !== 'string') {
    throw new HttpError(422, `${label} must be text.`, { field: label.toLowerCase() });
  }
  let text = value.replace(/\r\n/g, '\n').replace(CONTROL_CHARS, '').trim();
  if (!multiline) text = text.replace(/\s+/g, ' ');
  else text = text.replace(/\n{3,}/g, '\n\n');
  if (required && text.length < Math.max(1, min)) {
    throw new HttpError(422, `${label} must be at least ${min} characters.`, {
      field: label.toLowerCase(),
    });
  }
  if (text.length > max) {
    throw new HttpError(422, `${label} must be ${max} characters or fewer.`, {
      field: label.toLowerCase(),
    });
  }
  return text;
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

function validateEmail(value) {
  if (typeof value !== 'string') {
    throw new HttpError(422, 'A valid email is required.', { field: 'email' });
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    throw new HttpError(422, 'Enter a valid email address.', { field: 'email' });
  }
  return email;
}

function validatePassword(value, { label = 'Password', min = 12 } = {}) {
  if (typeof value !== 'string') {
    throw new HttpError(422, `${label} is required.`, { field: 'password' });
  }
  if (value.length < min) {
    throw new HttpError(422, `${label} must be at least ${min} characters.`, { field: 'password' });
  }
  if (value.length > 128) {
    throw new HttpError(422, `${label} must be 128 characters or fewer.`, { field: 'password' });
  }
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    throw new HttpError(422, `${label} must include both letters and numbers.`, {
      field: 'password',
    });
  }
  return value;
}

function validateHttpUrl(value, { label = 'Destination URL' } = {}) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new HttpError(422, `${label} must be a valid absolute URL.`, { field: 'externalUrl' });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(422, `${label} must start with https:// or http://.`, {
      field: 'externalUrl',
    });
  }
  if (url.username || url.password) {
    throw new HttpError(422, 'URLs containing embedded credentials are not allowed.', {
      field: 'externalUrl',
    });
  }
  const raw = url.toString();
  if (raw.length > 2048) {
    throw new HttpError(422, `${label} is too long (2048 character limit).`, {
      field: 'externalUrl',
    });
  }
  // Block obvious SSRF-style targets even though we only redirect clients.
  const host = url.hostname.toLowerCase();
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    'metadata.google.internal',
  ];
  if (blocked.includes(host)) {
    throw new HttpError(422, 'That destination host is not allowed.', { field: 'externalUrl' });
  }
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    throw new HttpError(422, 'Private network destinations are not allowed.', {
      field: 'externalUrl',
    });
  }
  return raw;
}

/**
 * COOKIES guardrail.
 * The cookie category is strictly for documentation and harmless text resources.
 * Credential dumps, session tokens and authentication cookies are rejected.
 */
const FORBIDDEN_COOKIE_PATTERNS = [
  /(session|auth(?:entication)?)[\s_-]*(token|cookie|key|credential)s?/i,
  /(cookie|token)s?[\s_-]*(dump|jar|list|export|value|file)/i,
  /\bcookies?\.txt\b/i,
  /\bnetscape\s+cookies?\b/i,
  /\b(login|account)\s+(credentials?|details?|access)\b/i,
  /\b(password|passwd|credential|2fa|otp)\b/i,
  /\b(cookie\s+stealer|stealer|token\s+grabber)\b/i,
  /\b(hacked|hack|cracked)\s+accounts?\b/i,
  /(netflix|spotify|disney\+?|hulu|crunchyroll|prime\s+video)\s+cookies?/i,
];

function assertCookieSafe(title, description, url) {
  const haystack = `${title}\n${description}\n${url}`;
  for (const pattern of FORBIDDEN_COOKIE_PATTERNS) {
    if (pattern.test(haystack)) {
      throw new HttpError(
        422,
        'Cookie-category drops may only contain documentation and harmless text resources. ' +
          'Credentials, session tokens and authentication cookies are not permitted.',
        { field: 'category', code: 'cookie_policy' }
      );
    }
  }
  if (!/^https:\/\//i.test(url)) {
    throw new HttpError(422, 'Cookie-category destinations must use HTTPS.', {
      field: 'externalUrl',
    });
  }
  if (description.trim().length < 40) {
    throw new HttpError(
      422,
      'Cookie-category drops need a description of at least 40 characters explaining the resource.',
      { field: 'description' }
    );
  }
}

function validateCategoryInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = cleanText(body.name, { min: 2, max: 32, label: 'Category name' }).toUpperCase();
  }
  if (!partial || body.description !== undefined) {
    out.description = cleanText(body.description, {
      min: 10,
      max: 500,
      multiline: true,
      label: 'Description',
    });
  }
  if (!partial || body.accent !== undefined) {
    const accent = String(body.accent || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(accent)) {
      throw new HttpError(422, 'Accent colour must be a hex value like #8B5CF6.', {
        field: 'accent',
      });
    }
    out.accent = accent.toUpperCase();
  }
  if (!partial || body.icon !== undefined) {
    const allowed = ['steam', 'xbox', 'cookie', 'grid', 'spark', 'shield', 'bolt', 'star'];
    const icon = String(body.icon || 'grid').trim().toLowerCase();
    if (!allowed.includes(icon)) {
      throw new HttpError(422, 'Choose a valid category icon.', { field: 'icon' });
    }
    out.icon = icon;
  }
  if (body.slug !== undefined && body.slug !== '') {
    const slug = slugify(body.slug);
    if (!slug || slug.length < 2) {
      throw new HttpError(422, 'Category slug is invalid.', { field: 'slug' });
    }
    out.slug = slug;
  }
  return out;
}

module.exports = {
  cleanText,
  slugify,
  validateEmail,
  validatePassword,
  validateHttpUrl,
  assertCookieSafe,
  validateCategoryInput,
};
