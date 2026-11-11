'use strict';

/**
 * End-to-end integration suite for REVOMAKER STEAM.
 *
 * Runs against a throwaway SQLite database on a random port, so it never
 * touches production data. The suite provisions three owner accounts, boots the
 * real HTTP server and exercises public pages, tracking, authentication,
 * CSRF protection, admin CRUD, uploads, category guards, COOKIES moderation
 * and error handling.
 *
 *   npm test
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * Isolated test database
 * ------------------------------------------------------------------ */

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'revomaker-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.sqlite');
const TEST_SECRET = crypto.randomBytes(48).toString('hex');
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

process.env.DB_PATH = TEST_DB;
process.env.APP_SECRET = TEST_SECRET;
process.env.PORT = String(PORT);
process.env.APP_URL = BASE;
process.env.COOKIE_SECURE = '0';
process.env.SEED_DEMO = '1';

const { db, run, get } = require('../server/db');
const { hashPassword } = require('../server/security');

const OWNER_PASSWORD = 'IntegrationPass123!';
const OWNER_EMAIL = 'owner.one@revomaker.test';
const OWNER2_EMAIL = 'owner.two@revomaker.test';
const OWNER3_EMAIL = 'owner.three@revomaker.test';

/* ------------------------------------------------------------------ *
 * Tiny test harness
 * ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n  ${name}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`   ✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ section: currentSection, name, error });
    console.log(`   ✗ ${name}`);
    console.log(`     ${error.message.split('\n')[0]}`);
  }
}

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function request(pathname, options = {}) {
  const { method = 'GET', body, cookie, csrf, headers = {}, redirect = 'manual' } = options;
  const finalHeaders = { ...headers };
  if (cookie) finalHeaders.cookie = cookie;
  if (csrf) finalHeaders['x-csrf-token'] = csrf;

  let payload = body;
  if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    finalHeaders['content-type'] = 'application/json';
  }

  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: finalHeaders,
    body: payload,
    redirect,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }

  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    cookies: typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [],
  };
}

function sessionCookieFrom(response) {
  const cookie = response.cookies.find((entry) => entry.startsWith('rv_session='));
  assert.ok(cookie, 'expected an rv_session cookie');
  return cookie.split(';')[0];
}

/* ------------------------------------------------------------------ *
 * Server lifecycle
 * ------------------------------------------------------------------ */

let serverProcess = null;

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`server did not become ready: ${lastError?.message || 'timeout'}`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    serverProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ *
 * Suite
 * ------------------------------------------------------------------ */

async function main() {
  console.log('\n  REVOMAKER STEAM — integration test suite');
  console.log('  ----------------------------------------');

  // Three owner accounts, straight into the isolated database.
  const ownerHash = await hashPassword(OWNER_PASSWORD);
  const secondHash = await hashPassword(OWNER_PASSWORD);
  const thirdHash = await hashPassword(OWNER_PASSWORD);
  const now = new Date().toISOString();
  run(
    `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', ?, ?)`,
    'Integration Owner',
    OWNER_EMAIL,
    ownerHash,
    now,
    now
  );
  run(
    `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', ?, ?)`,
    'Second Owner',
    OWNER2_EMAIL,
    secondHash,
    now,
    now
  );
  run(
    `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', ?, ?)`,
    'Third Owner',
    OWNER3_EMAIL,
    thirdHash,
    now,
    now
  );

  serverProcess = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'server/index.js'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        APP_URL: BASE,
        DB_PATH: TEST_DB,
        APP_SECRET: TEST_SECRET,
        COOKIE_SECURE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  let serverLog = '';
  serverProcess.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  serverProcess.once('exit', (code) => {
    if (code && code !== 0) serverLog += `\n[server exited with ${code}]`;
  });

  try {
    await waitForServer();
  } catch (error) {
    console.error(`\n  Could not start test server.\n${serverLog}\n`);
    throw error;
  }

  let session = '';
  let csrf = '';
  let createdDropId = null;
  let createdSlug = '';
  let createdUpload = '';
  let createdCategoryId = null;
  let overviewBefore = null;

  try {
    /* ------------------------------ public ------------------------------ */
    section('Public API');

    await test('health endpoint reports the service', async () => {
      const res = await request('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.service, 'revomaker-steam');
    });

    await test('setup status reports three owners', async () => {
      const res = await request('/api/setup-status');
      assert.equal(res.status, 200);
      assert.equal(res.json.owners, 3);
      assert.equal(res.json.ready, true);
    });

    await test('overview numbers are computed from the database', async () => {
      const res = await request('/api/stats/overview');
      assert.equal(res.status, 200);
      assert.ok(res.json.totalDrops >= 12);
      assert.equal(typeof res.json.totalViews, 'number');
      assert.equal(typeof res.json.totalClicks, 'number');
      assert.equal(res.json.series.length, 7);
      overviewBefore = res.json;
    });

    await test('categories expose all four lanes with counts', async () => {
      const res = await request('/api/categories');
      assert.equal(res.status, 200);
      assert.equal(res.json.categories.length, 4);
      const slugs = res.json.categories.map((c) => c.slug).sort();
      assert.deepEqual(slugs, ['cookies', 'other', 'steam', 'xbox']);
      assert.ok(res.json.categories.every((c) => c.drops >= 1));
    });

    await test('demo drops are listed and drafts stay hidden', async () => {
      const res = await request('/api/drops?limit=24');
      assert.equal(res.status, 200);
      assert.equal(res.json.total, 12);
      assert.ok(res.json.drops.every((drop) => drop.status === 'published'));
      assert.ok(!res.json.drops.some((drop) => drop.slug === 'cloud-gaming-setup-guide'));
      assert.equal(res.json.drops[0].externalUrl !== undefined, true);
    });

    await test('category filtering returns only that lane', async () => {
      const res = await request('/api/drops?category=xbox&limit=24');
      assert.equal(res.status, 200);
      assert.ok(res.json.drops.length >= 3);
      assert.ok(res.json.drops.every((drop) => drop.category.slug === 'xbox'));
    });

    await test('unknown category returns a clean 404', async () => {
      const res = await request('/api/drops?category=nope');
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, 'category_not_found');
    });

    await test('search matches titles and escapes LIKE wildcards', async () => {
      const found = await request('/api/drops?q=Chromatic');
      assert.equal(found.status, 200);
      assert.ok(found.json.drops.some((drop) => drop.slug === 'chromatic-drift-demo-key'));

      const injection = await request('/api/drops?q=%27%20OR%201%3D1%20--');
      assert.equal(injection.status, 200);
      assert.equal(injection.json.total, 0);
    });

    await test('sorting and pagination return coherent metadata', async () => {
      const res = await request('/api/drops?sort=popular&limit=2&page=2');
      assert.equal(res.status, 200);
      assert.equal(res.json.drops.length, 2);
      assert.equal(res.json.page, 2);
      assert.equal(res.json.limit, 2);
      assert.ok(res.json.pages >= 6);
      assert.equal(res.json.hasMore, true);
    });

    await test('drop detail includes related drops and destination host', async () => {
      const res = await request('/api/drops/chromatic-drift-demo-key');
      assert.equal(res.status, 200);
      assert.equal(res.json.drop.category.slug, 'steam');
      assert.ok(res.json.drop.externalHost.includes('steampowered.com'));
      assert.ok(Array.isArray(res.json.related));
    });

    await test('draft drop detail is not publicly readable', async () => {
      const res = await request('/api/drops/cloud-gaming-setup-guide');
      assert.equal(res.status, 404);
    });

    await test('popular and activity endpoints have stable shapes', async () => {
      const popular = await request('/api/popular?limit=5');
      assert.equal(popular.status, 200);
      assert.ok(popular.json.drops.length <= 5);

      const activity = await request('/api/activity?days=7');
      assert.equal(activity.status, 200);
      assert.equal(activity.json.series.length, 7);
    });

    /* ------------------------------ pages ------------------------------ */
    section('Public pages');

    await test('homepage renders with a strict CSP and security headers', async () => {
      const res = await request('/');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('REVOMAKER STEAM'));
      assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });

    await test('category page renders for every lane', async () => {
      for (const slug of ['steam', 'xbox', 'cookies', 'other']) {
        const res = await request(`/category/${slug}`);
        assert.equal(res.status, 200, `${slug} should render`);
        assert.ok(res.text.includes('REVOMAKER STEAM'));
      }
    });

    await test('drop page injects title, canonical and JSON-LD meta', async () => {
      const res = await request('/drop/chromatic-drift-demo-key');
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('Chromatic Drift'));
      assert.ok(res.text.includes('rel="canonical"'));
      assert.ok(res.text.includes('application/ld+json'));
    });

    await test('unknown pages render the branded 404 with a 404 status', async () => {
      const page = await request('/drop/does-not-exist');
      assert.equal(page.status, 404);
      assert.ok(page.text.includes('REVOMAKER STEAM'));

      const api = await request('/api/does-not-exist');
      assert.equal(api.status, 404);
      assert.equal(api.json.error.code, 'not_found');
    });

    await test('authentication-required admin page redirects to login', async () => {
      const res = await request('/admin');
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/admin/login');

      const login = await request('/admin/login');
      assert.equal(login.status, 200);
      assert.ok(login.text.includes('REVOMAKER STEAM'));
    });

    await test('static assets and uploads are served with safe content types', async () => {
      const css = await request('/css/site.css');
      assert.equal(css.status, 200);
      assert.match(css.headers.get('content-type') || '', /text\/css/);

      const emblem = await request('/assets/brand/emblem.png');
      assert.equal(emblem.status, 200);
      assert.match(emblem.headers.get('content-type') || '', /image\/png/);

      const traversal = await request('/assets/%2e%2e/%2e%2e/package.json');
      assert.equal(traversal.status, 404);
    });

    await test('non-GET page requests are rejected', async () => {
      const res = await request('/', { method: 'POST' });
      assert.equal(res.status, 405);
    });

    /* ----------------------------- tracking ----------------------------- */
    section('Visitor tracking and GET DROP');

    let visitCookie = '';

    await test('visit tracking issues an HttpOnly visitor cookie', async () => {
      const res = await request('/api/visit', {
        method: 'POST',
        body: { path: '/category/steam' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.ok(res.json.visitors >= 1);

      const cookie = res.cookies.find((entry) => entry.startsWith('rv_vid='));
      assert.ok(cookie, 'expected a visitor cookie');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      visitCookie = cookie.split(';')[0];
    });

    await test('drop views increment once per visitor window', async () => {
      const first = await request('/api/drops/chromatic-drift-demo-key/view', {
        method: 'POST',
        cookie: visitCookie,
        body: {},
      });
      assert.equal(first.status, 200);
      assert.equal(first.json.counted, true);
      assert.ok(first.json.views >= 1);

      const duplicate = await request('/api/drops/chromatic-drift-demo-key/view', {
        method: 'POST',
        cookie: visitCookie,
        body: {},
      });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.json.counted, false);
      assert.equal(duplicate.json.views, first.json.views);
    });

    await test('click tracking returns the destination host', async () => {
      const res = await request('/api/drops/chromatic-drift-demo-key/click', {
        method: 'POST',
        cookie: visitCookie,
        body: {},
      });
      assert.equal(res.status, 200);
      assert.ok(res.json.clicks >= 1);
      assert.ok(res.json.url.startsWith('https://'));
      assert.ok(res.json.host.includes('steampowered.com'));
    });

    await test('GET DROP redirects to the external URL and records a click', async () => {
      const before = await request('/api/drops/chromatic-drift-demo-key');
      const res = await request('/go/chromatic-drift-demo-key', { cookie: visitCookie });
      assert.equal(res.status, 302);
      assert.ok(res.headers.get('location').startsWith('https://'));
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

      const after = await request('/api/drops/chromatic-drift-demo-key');
      assert.equal(after.json.drop.clicks, before.json.drop.clicks + 1);
    });

    await test('unknown GET DROP slug returns the branded 404', async () => {
      const res = await request('/go/not-a-real-drop');
      assert.equal(res.status, 404);
    });

    await test('public totals reflect tracked events', async () => {
      const res = await request('/api/stats/overview');
      assert.equal(res.status, 200);
      assert.ok(res.json.totalViews > overviewBefore.totalViews);
      assert.ok(res.json.totalClicks > overviewBefore.totalClicks);
      assert.ok(res.json.totalVisitors >= overviewBefore.totalVisitors);
    });

    /* ------------------------------- auth ------------------------------- */
    section('Authentication and session security');

    await test('admin APIs reject anonymous requests', async () => {
      for (const endpoint of [
        '/api/admin/overview',
        '/api/admin/drops',
        '/api/admin/analytics',
        '/api/admin/categories',
        '/api/admin/activity',
        '/api/admin/owners',
      ]) {
        const res = await request(endpoint);
        assert.equal(res.status, 401, `${endpoint} should be protected`);
      }
    });

    await test('wrong credentials are rejected generically', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: OWNER_EMAIL, password: 'wrong-password' },
      });
      assert.equal(res.status, 401);
      assert.equal(res.json.error.message, 'Invalid email or password.');
    });

    await test('correct credentials create an HttpOnly session', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.user.email, OWNER_EMAIL);
      assert.ok(res.json.csrfToken.length >= 16);
      csrf = res.json.csrfToken;
      session = sessionCookieFrom(res);

      const raw = res.cookies.find((entry) => entry.startsWith('rv_session='));
      assert.match(raw, /HttpOnly/i);
      assert.match(raw, /SameSite=Lax/i);
      assert.match(raw, /Path=\//i);
    });

    await test('/api/auth/me returns the signed-in owner', async () => {
      const res = await request('/api/auth/me', { cookie: session });
      assert.equal(res.status, 200);
      assert.equal(res.json.user.email, OWNER_EMAIL);
      assert.equal(res.json.user.role, 'owner');
      assert.equal(res.json.csrfToken, csrf);
    });

    await test('admin shell is served to a signed-in owner only', async () => {
      const res = await request('/admin', { cookie: session });
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('id="admin-app"') || res.text.includes('admin-shell'));
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');

      const login = await request('/admin/login', { cookie: session });
      assert.equal(login.status, 302);
      assert.equal(login.headers.get('location'), '/admin');
    });

    await test('state-changing requests require a valid CSRF token', async () => {
      const missing = await request('/api/auth/logout', {
        method: 'POST',
        cookie: session,
        body: {},
      });
      assert.equal(missing.status, 403);
      assert.equal(missing.json.error.code, 'csrf_failed');

      const wrong = await request('/api/auth/logout', {
        method: 'POST',
        cookie: session,
        csrf: 'x'.repeat(32),
        body: {},
      });
      assert.equal(wrong.status, 403);

      // Still authenticated after the rejected attempts.
      const me = await request('/api/auth/me', { cookie: session });
      assert.equal(me.status, 200);
    });

    /* --------------------------- admin console -------------------------- */
    section('Admin dashboard APIs');

    await test('overview and analytics compute live data', async () => {
      const overview = await request('/api/admin/overview', { cookie: session });
      assert.equal(overview.status, 200);
      assert.equal(overview.json.published, 12);
      assert.equal(overview.json.drafts, 1);
      assert.equal(overview.json.categories.length, 4);
      assert.ok(overview.json.series.length === 14);

      const analytics = await request('/api/admin/analytics?days=7', { cookie: session });
      assert.equal(analytics.status, 200);
      assert.equal(analytics.json.days, 7);
      assert.equal(analytics.json.series.length, 7);
      assert.ok(Array.isArray(analytics.json.topDrops));
      assert.ok(Array.isArray(analytics.json.devices));
      assert.ok(Array.isArray(analytics.json.referrers));
      assert.ok(Array.isArray(analytics.json.monthly));
    });

    await test('admin drop list supports status, category and search filters', async () => {
      const drafts = await request('/api/admin/drops?status=draft', { cookie: session });
      assert.equal(drafts.status, 200);
      assert.equal(drafts.json.total, 1);

      const steam = await request('/api/admin/drops?category=steam', { cookie: session });
      assert.equal(steam.status, 200);
      assert.ok(steam.json.drops.every((drop) => drop.category.slug === 'steam'));

      const search = await request('/api/admin/drops?q=Halo', { cookie: session });
      assert.equal(search.status, 200);
      assert.ok(search.json.drops.some((drop) => drop.title.includes('Halo')));
    });

    await test('categories expose admin counts', async () => {
      const res = await request('/api/admin/categories', { cookie: session });
      assert.equal(res.status, 200);
      assert.equal(res.json.categories.length, 4);
      assert.ok(res.json.categories.every((category) => typeof category.totalDrops === 'number'));
    });

    await test('activity feed includes recent events and audit entries', async () => {
      const res = await request('/api/admin/activity', { cookie: session });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.recent));
      assert.ok(Array.isArray(res.json.audit));
      assert.ok(res.json.audit.some((entry) => entry.action === 'login'));
    });

    await test('owners endpoint is limited to the three accounts', async () => {
      const res = await request('/api/admin/owners', { cookie: session });
      assert.equal(res.status, 200);
      assert.equal(res.json.limit, 3);
      assert.equal(res.json.owners.length, 3);
      assert.equal(res.json.owners.filter((owner) => owner.current).length, 1);
    });

    /* --------------------------- drop CRUD -------------------------- */
    section('Drop management');

    await test('create validates required fields', async () => {
      const short = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: { title: 'Hi', description: 'too short', category: 'steam', externalUrl: 'https://example.com/' },
      });
      assert.equal(short.status, 422);

      const badCategory = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Valid title here',
          description: 'A sufficiently long description for validation.',
          category: 'nope',
          externalUrl: 'https://example.com/',
        },
      });
      assert.equal(badCategory.status, 422);

      const badUrl = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Valid title here',
          description: 'A sufficiently long description for validation.',
          category: 'steam',
          externalUrl: 'javascript:alert(1)',
        },
      });
      assert.equal(badUrl.status, 422);

      const credentials = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Valid title here',
          description: 'A sufficiently long description for validation.',
          category: 'steam',
          externalUrl: 'https://user:pass@example.com/',
        },
      });
      assert.equal(credentials.status, 422);
    });

    await test('COOKIES guardrail blocks credentials and insecure URLs', async () => {
      const creds = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Netflix cookies bundle',
          description: 'A long enough description that still tries to smuggle authentication cookies into the catalogue.',
          category: 'cookies',
          externalUrl: 'https://example.com/cookies',
        },
      });
      assert.equal(creds.status, 422);
      assert.equal(creds.json.error.code, 'cookie_policy');

      const insecure = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Cookie documentation pack',
          description: 'A harmless documentation resource explaining browser cookie hygiene for everyday users.',
          category: 'cookies',
          externalUrl: 'http://example.com/cookies',
        },
      });
      assert.equal(insecure.status, 422);

      const healthy = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Cookie documentation pack',
          description: 'A harmless documentation resource explaining browser cookie hygiene for everyday users.',
          category: 'cookies',
          externalUrl: 'https://example.com/cookies',
          status: 'draft',
        },
      });
      assert.equal(healthy.status, 201, JSON.stringify(healthy.json));
      const cleanup = await request(`/api/admin/drops/${healthy.json.drop.id}`, {
        method: 'DELETE',
        cookie: session,
        csrf,
      });
      assert.equal(cleanup.status, 200);
    });

    await test('create saves a draft with an uploaded thumbnail', async () => {
      const res = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Integration Test Drop',
          description: 'A complete integration drop used to verify publishing, tracking, uploads and cleanup.',
          category: 'other',
          externalUrl: 'https://example.com/integration-drop',
          status: 'draft',
          thumbnail: tinyPng,
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.json));
      createdDropId = res.json.drop.id;
      createdSlug = res.json.drop.slug;
      assert.equal(res.json.drop.status, 'draft');
      assert.equal(res.json.drop.slug, 'integration-test-drop');
      assert.match(res.json.drop.thumbnail, /^\/uploads\/[a-z0-9-]+\.png$/);

      createdUpload = res.json.drop.thumbnail;
      const asset = await request(createdUpload);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type') || '', /image\/png/);
    });

    await test('thumbnail upload rejects non-image payloads', async () => {
      const res = await request('/api/admin/drops', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          title: 'Malicious upload attempt',
          description: 'This request claims to be a PNG but contains plain text instead of image bytes.',
          category: 'other',
          externalUrl: 'https://example.com/nope',
          thumbnail: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`,
        },
      });
      assert.equal(res.status, 422);
      assert.equal(res.json.error.field, 'thumbnail');
    });

    await test('drafts stay private until published', async () => {
      const publicDetail = await request(`/api/drops/${createdSlug}`);
      assert.equal(publicDetail.status, 404);

      const adminDetail = await request(`/api/admin/drops/${createdDropId}`, { cookie: session });
      assert.equal(adminDetail.status, 200);
      assert.equal(adminDetail.json.drop.status, 'draft');
    });

    await test('edit and publish a drop through PATCH', async () => {
      const res = await request(`/api/admin/drops/${createdDropId}`, {
        method: 'PATCH',
        cookie: session,
        csrf,
        body: {
          title: 'Integration Test Drop — Published',
          featured: true,
          status: 'published',
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal(res.json.drop.status, 'published');
      assert.equal(res.json.drop.featured, true);
      assert.equal(res.json.drop.title, 'Integration Test Drop — Published');

      const publicDetail = await request(`/api/drops/${createdSlug}`);
      assert.equal(publicDetail.status, 200);
      assert.equal(publicDetail.json.drop.featured, true);
    });

    await test('published drop is visible in search and featured listings', async () => {
      const search = await request('/api/drops?q=Integration%20Test');
      assert.equal(search.status, 200);
      assert.ok(search.json.drops.some((drop) => drop.id === createdDropId));

      const featured = await request('/api/drops?featured=1&limit=24');
      assert.equal(featured.status, 200);
      assert.ok(featured.json.drops.some((drop) => drop.id === createdDropId));
    });

    await test('per-drop stats reflect real views and clicks', async () => {
      await request(`/api/drops/${createdSlug}/view`, {
        method: 'POST',
        cookie: visitCookie,
        body: {},
      });
      await request(`/api/drops/${createdSlug}/click`, {
        method: 'POST',
        cookie: visitCookie,
        body: {},
      });

      const stats = await request(`/api/admin/drops/${createdDropId}/stats`, { cookie: session });
      assert.equal(stats.status, 200);
      assert.ok(stats.json.views >= 1);
      assert.ok(stats.json.clicks >= 1);
      assert.equal(stats.json.series.length, 30);
      assert.ok(stats.json.lastEvents.length >= 2);
    });

    await test('remove thumbnail restores the category fallback', async () => {
      const res = await request(`/api/admin/drops/${createdDropId}`, {
        method: 'PATCH',
        cookie: session,
        csrf,
        body: { removeThumbnail: true },
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.drop.thumbnail, '/assets/drops/fallback-other.svg');

      const gone = await request(createdUpload);
      assert.equal(gone.status, 404);
      createdUpload = '';
    });

    await test('deleting a drop removes it from every listing', async () => {
      const res = await request(`/api/admin/drops/${createdDropId}`, {
        method: 'DELETE',
        cookie: session,
        csrf,
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.deleted, createdDropId);

      const gone = await request(`/api/admin/drops/${createdDropId}`, { cookie: session });
      assert.equal(gone.status, 404);
      const publicGone = await request(`/api/drops/${createdSlug}`);
      assert.equal(publicGone.status, 404);
    });

    /* -------------------------- category CRUD -------------------------- */
    section('Category management');

    await test('categories cannot be deleted while drops use them', async () => {
      const categories = await request('/api/admin/categories', { cookie: session });
      const steam = categories.json.categories.find((category) => category.slug === 'steam');
      const res = await request(`/api/admin/categories/${steam.id}`, {
        method: 'DELETE',
        cookie: session,
        csrf,
      });
      assert.equal(res.status, 409);
      assert.equal(res.json.error.code, 'category_in_use');
    });

    await test('create, update and delete an empty category', async () => {
      const create = await request('/api/admin/categories', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          name: 'Integration Lane',
          description: 'A temporary category created by the integration suite.',
          accent: '#123ABC',
          icon: 'spark',
          slug: 'integration-lane',
        },
      });
      assert.equal(create.status, 201, JSON.stringify(create.json));
      createdCategoryId = create.json.id;

      const update = await request(`/api/admin/categories/${createdCategoryId}`, {
        method: 'PATCH',
        cookie: session,
        csrf,
        body: { name: 'Integration Lane 2', description: 'Updated category description.' },
      });
      assert.equal(update.status, 200);

      const list = await request('/api/admin/categories', { cookie: session });
      const row = list.json.categories.find((category) => category.id === createdCategoryId);
      assert.equal(row.name, 'INTEGRATION LANE 2');
      assert.equal(row.slug, 'integration-lane');

      const remove = await request(`/api/admin/categories/${createdCategoryId}`, {
        method: 'DELETE',
        cookie: session,
        csrf,
      });
      assert.equal(remove.status, 200);
      const page = await request('/category/integration-lane');
      assert.equal(page.status, 404);
    });

    await test('category validation rejects duplicate slugs and bad colours', async () => {
      const duplicate = await request('/api/admin/categories', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          name: 'Duplicate Steam',
          description: 'Trying to collide with an existing category slug.',
          accent: '#8B5CF6',
          icon: 'steam',
          slug: 'steam',
        },
      });
      assert.equal(duplicate.status, 409);

      const colour = await request('/api/admin/categories', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {
          name: 'Bad Colour',
          description: 'Invalid accent colour should fail validation.',
          accent: 'purple',
          icon: 'grid',
        },
      });
      assert.equal(colour.status, 422);
    });

    /* ------------------------ sessions / password ------------------------ */
    section('Owner security controls');

    await test('sessions endpoint lists the current session', async () => {
      const res = await request('/api/auth/sessions', { cookie: session });
      assert.equal(res.status, 200);
      assert.ok(res.json.sessions.some((entry) => entry.current));
    });

    await test('audit log records owner actions', async () => {
      const res = await request('/api/admin/activity', { cookie: session });
      assert.equal(res.status, 200);
      const actions = res.json.audit.map((entry) => entry.action);
      assert.ok(actions.includes('drop_created'));
      assert.ok(actions.includes('drop_published'));
      assert.ok(actions.includes('drop_deleted'));
      assert.ok(actions.includes('category_created'));
    });

    await test('logout revokes the session cookie', async () => {
      const res = await request('/api/auth/logout', {
        method: 'POST',
        cookie: session,
        csrf,
        body: {},
      });
      assert.equal(res.status, 200);
      assert.ok(
        res.cookies.some((cookie) => cookie.startsWith('rv_session=') && /Max-Age=0/i.test(cookie)),
        'expected the session cookie to be cleared'
      );

      const me = await request('/api/auth/me', { cookie: session });
      assert.equal(me.status, 401);
    });

    await test('second owner can sign in independently', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: OWNER2_EMAIL, password: OWNER_PASSWORD },
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.user.email, OWNER2_EMAIL);
      session = sessionCookieFrom(res);
      csrf = res.json.csrfToken;
      const overview = await request('/api/admin/overview', { cookie: session });
      assert.equal(overview.status, 200);
    });

    await test('a fourth owner cannot be provisioned', async () => {
      assert.throws(
        () =>
          run(
            `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
             VALUES ('Fourth', 'fourth@revomaker.test', 'x', 'owner', ?, ?)`,
            now,
            now
          ),
        /owner_limit_reached/
      );
      assert.equal(get('SELECT COUNT(*) AS c FROM users').c, 3);
    });
  } finally {
    await stopServer();
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  console.log('\n  ----------------------------------------');
  console.log(`  ${passed} passed, ${failed} failed`);

  if (failed) {
    console.log('\n  Failures:');
    for (const failure of failures) {
      console.log(`\n  [${failure.section}] ${failure.name}`);
      console.log(`  ${failure.error.stack?.split('\n').slice(0, 4).join('\n  ') || failure.error.message}`);
    }
    console.log('');
    process.exitCode = 1;
    return;
  }

  console.log('  All integration checks passed.\n');
}

main().catch(async (error) => {
  console.error('\n  Test suite crashed:', error.stack || error.message, '\n');
  await stopServer();
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
