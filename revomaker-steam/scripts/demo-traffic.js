'use strict';

/**
 * Optional demo traffic generator.
 *
 * The application never displays hardcoded statistics — everything is computed
 * from recorded rows. This script inserts *real* event rows (spread over the
 * last 30 days) so the dashboard charts have something to show on a fresh
 * install. Run `npm run reset:stats` before going live.
 *
 *   npm run demo:traffic
 *   npm run demo:traffic -- --force   (replace existing demo activity)
 */

const crypto = require('node:crypto');
const { all, get, run, tx, nowIso } = require('../server/db');
const { hashVisitorId } = require('../server/security');

const flags = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
}

const DAYS = Math.min(Math.max(Number(flags.days) || 30, 7), 90);
const SCALE = Math.min(Math.max(Number(flags.scale) || 1, 0.2), 3);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5e0a2026);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (min, max) => min + Math.floor(rnd() * (max - min + 1));

const existing = get('SELECT COUNT(*) AS c FROM events').c;
if (existing > 0 && !flags.force) {
  console.log(`\n  ${existing} events already exist. Re-run with -- --force to replace demo activity.\n`);
  process.exit(0);
}

const drops = all(
  `SELECT d.id, d.slug, d.category_id, c.slug AS category FROM drops d
     JOIN categories c ON c.id = d.category_id
    WHERE d.status = 'published' ORDER BY d.id ASC`
);
if (!drops.length) {
  console.error('  No published drops found. Start the app once to seed the catalogue.');
  process.exit(1);
}

const weights = drops.map((_, index) => Math.max(1, 8 - index));
const totalWeight = weights.reduce((a, b) => a + b, 0);
function weightedDrop() {
  let roll = rnd() * totalWeight;
  for (let i = 0; i < drops.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return drops[i];
  }
  return drops[0];
}

const devices = [
  ['desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36', 6],
  ['desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36', 2],
  ['mobile', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.0 Mobile Safari/604.1', 3],
  ['mobile', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0 Mobile Safari/537.36', 2],
  ['tablet', 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) Version/18.0 Mobile Safari/604.1', 1],
];
const devicePool = devices.flatMap(([device, ua, weight]) => Array.from({ length: weight }, () => ({ device, ua })));
const referrers = [null, null, null, 'https://www.google.com/', 'https://x.com/', 'https://discord.com/', 'https://www.reddit.com/'];

const isoTimestamp = (date, hour, minute) => {
  const d = new Date(date);
  d.setUTCHours(hour, minute, Math.floor(rnd() * 60), 0);
  return d.toISOString();
};

let visitorTotal = 0;
let viewTotal = 0;
let clickTotal = 0;
let visitTotal = 0;

tx(() => {
  run('DELETE FROM events');
  run('DELETE FROM visitors');
  run('UPDATE drops SET views = 0, clicks = 0');

  const insertVisitor = require('../server/db').db.prepare(
    `INSERT INTO visitors (id, first_seen, last_seen, device, referrer, visits)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertEvent = require('../server/db').db.prepare(
    `INSERT INTO events (type, drop_id, category_id, visitor_id, path, referrer, device, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const recencyBoost = offset < 7 ? 1.9 : offset > 20 ? 0.65 : 1;
    const dailyVisitors = Math.max(3, Math.round(between(9, 24) * recencyBoost * SCALE));

    for (let i = 0; i < dailyVisitors; i += 1) {
      visitorTotal += 1;
      const visitorId = hashVisitorId(crypto.randomBytes(18).toString('hex'));
      const { device, ua } = pick(devicePool);
      const referrer = pick(referrers);
      const firstHour = between(8, 22);
      const firstMinute = between(0, 59);
      const firstSeen = isoTimestamp(date, firstHour, firstMinute);
      const visits = between(1, 3);
      let lastSeen = firstSeen;

      for (let v = 0; v < visits; v += 1) {
        visitTotal += 1;
        const hour = Math.min(23, firstHour + v * between(0, 2));
        const at = isoTimestamp(date, hour, between(0, 59));
        lastSeen = at;
        const landing = rnd() < 0.55 ? '/' : rnd() < 0.6 ? `/category/${pick(drops).category}` : '/';
        insertEvent.run('visit', null, null, visitorId, landing, referrer ? new URL(referrer).hostname.replace(/^www\./, '') : null, device, day, at);
      }

      insertVisitor.run(visitorId, firstSeen, lastSeen, device, referrer ? new URL(referrer).hostname.replace(/^www\./, '') : null, visits);

      const viewCount = rnd() < 0.18 ? 0 : between(1, 4);
      for (let v = 0; v < viewCount; v += 1) {
        const drop = weightedDrop();
        viewTotal += 1;
        const at = isoTimestamp(date, between(9, 23), between(0, 59));
        insertEvent.run('view', drop.id, drop.category_id, visitorId, `/drop/${drop.slug}`, null, device, day, at);
      }
      const clickCount = viewCount > 0 ? (rnd() < 0.34 ? between(1, 2) : 0) : 0;
      for (let c = 0; c < clickCount; c += 1) {
        const drop = weightedDrop();
        clickTotal += 1;
        const at = isoTimestamp(date, between(9, 23), between(0, 59));
        insertEvent.run('click', drop.id, drop.category_id, visitorId, `/go/${drop.slug}`, null, device, day, at);
      }
    }
  }

  run(`UPDATE drops SET
         views = (SELECT COUNT(*) FROM events e WHERE e.drop_id = drops.id AND e.type = 'view'),
         clicks = (SELECT COUNT(*) FROM events e WHERE e.drop_id = drops.id AND e.type = 'click')`);
});

console.log('\n  REVOMAKER STEAM — demo traffic generated (real event rows)');
console.log('  ---------------------------------------------------------');
console.log(`  Days        ${DAYS}`);
console.log(`  Visitors    ${visitorTotal}`);
console.log(`  Page views  ${visitTotal}`);
console.log(`  Drop views  ${viewTotal}`);
console.log(`  Clicks      ${clickTotal}`);
console.log('\n  Run "npm run reset:stats" before going live.\n');
