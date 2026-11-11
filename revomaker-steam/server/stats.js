'use strict';

const { run, get, all, tx, nowIso, dayOf } = require('./db');

function deviceFromUa(ua = '') {
  const value = String(ua).toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(value)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|windows phone/.test(value)) return 'mobile';
  return 'desktop';
}

function referrerHost(referrer) {
  if (!referrer) return null;
  try {
    return new URL(String(referrer)).hostname.replace(/^www\./, '').slice(0, 100);
  } catch {
    return null;
  }
}

function safePath(value) {
  if (typeof value !== 'string') return '/';
  const path = value.replace(/[^\w\-./?=&%#@:+]/g, '').slice(0, 200);
  return path.startsWith('/') ? path : `/${path}`;
}

function trackVisit({ visitorId, path, referrer, ua }) {
  const now = new Date();
  const day = dayOf(now);
  const dayAgo = nowIso();
  const device = deviceFromUa(ua);
  const ref = referrerHost(referrer);
  const cleanPath = safePath(path);

  return tx(() => {
    const duplicate = get(
      `SELECT id FROM events
        WHERE type = 'visit' AND visitor_id = ? AND path = ?
          AND created_at > datetime('now', '-10 minutes')
        LIMIT 1`,
      visitorId,
      cleanPath
    );

    const existing = get('SELECT id FROM visitors WHERE id = ?', visitorId);
    if (existing) {
      run(
        'UPDATE visitors SET last_seen = ?, device = COALESCE(?, device) WHERE id = ?',
        now.toISOString(),
        device,
        visitorId
      );
    } else {
      run(
        `INSERT INTO visitors (id, first_seen, last_seen, device, referrer, visits)
         VALUES (?, ?, ?, ?, ?, 1)`,
        visitorId,
        now.toISOString(),
        now.toISOString(),
        device,
        ref
      );
    }

    if (!duplicate) {
      run(
        `INSERT INTO events (type, drop_id, category_id, visitor_id, path, referrer, device, day, created_at)
         VALUES ('visit', NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        visitorId,
        cleanPath,
        ref,
        device,
        day,
        now.toISOString()
      );
      run('UPDATE visitors SET visits = visits + 1 WHERE id = ?', visitorId);
    }

    const totals = get(
      `SELECT (SELECT COUNT(*) FROM visitors) AS visitors,
              (SELECT COUNT(*) FROM events WHERE type = 'visit' AND day = ?) AS visitsToday`,
      day
    );
    return { visitors: totals.visitors, visitsToday: totals.visitsToday };
  });
}

function recordView(drop, visitorId) {
  const now = new Date();
  return tx(() => {
    const duplicate = get(
      `SELECT id FROM events
        WHERE type = 'view' AND drop_id = ? AND visitor_id = ?
          AND created_at > datetime('now', '-30 minutes')
        LIMIT 1`,
      drop.id,
      visitorId
    );
    if (!duplicate) {
      run(
        `INSERT INTO events (type, drop_id, category_id, visitor_id, path, referrer, device, day, created_at)
         VALUES ('view', ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        drop.id,
        drop.category_id,
        visitorId,
        `/drop/${drop.slug}`,
        dayOf(now),
        now.toISOString()
      );
      run('UPDATE drops SET views = views + 1 WHERE id = ?', drop.id);
    }
    const row = get('SELECT views FROM drops WHERE id = ?', drop.id);
    return { views: row?.views || 0, counted: !duplicate };
  });
}

function recordClick(drop, visitorId) {
  const now = new Date();
  return tx(() => {
    run(
      `INSERT INTO events (type, drop_id, category_id, visitor_id, path, referrer, device, day, created_at)
       VALUES ('click', ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      drop.id,
      drop.category_id,
      visitorId,
      `/go/${drop.slug}`,
      dayOf(now),
      now.toISOString()
    );
    run('UPDATE drops SET clicks = clicks + 1 WHERE id = ?', drop.id);
    const row = get('SELECT clicks FROM drops WHERE id = ?', drop.id);
    return { clicks: row?.clicks || 0 };
  });
}

function dayRange(days) {
  const out = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function series(days = 14, dropId = null) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDay = start.toISOString().slice(0, 10);
  const params = [startDay];
  let where = 'day >= ?';
  if (dropId) {
    where += ' AND drop_id = ?';
    params.push(dropId);
  }
  const rows = all(
    `SELECT day,
            SUM(CASE WHEN type = 'view'  THEN 1 ELSE 0 END) AS views,
            SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks,
            SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits
       FROM events
      WHERE ${where}
      GROUP BY day
      ORDER BY day ASC`,
    ...params
  );
  const map = new Map(rows.map((r) => [r.day, r]));
  return dayRange(days).map((day) => {
    const row = map.get(day);
    return {
      day,
      views: row?.views || 0,
      clicks: row?.clicks || 0,
      visits: row?.visits || 0,
    };
  });
}

function periodTotals(days = 7) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const since = start.toISOString().slice(0, 10);
  return get(
    `SELECT
       SUM(CASE WHEN type = 'view'  THEN 1 ELSE 0 END) AS views,
       SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks,
       SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits
     FROM events WHERE day >= ?`,
    since
  );
}

function publicOverview() {
  const counts = get(
    `SELECT
       (SELECT COUNT(*) FROM drops WHERE status = 'published') AS totalDrops,
       (SELECT COALESCE(SUM(views), 0)  FROM drops WHERE status = 'published') AS totalViews,
       (SELECT COALESCE(SUM(clicks), 0) FROM drops WHERE status = 'published') AS totalClicks,
       (SELECT COUNT(*) FROM visitors) AS totalVisitors,
       (SELECT COUNT(*) FROM categories) AS totalCategories`
  );
  return {
    ...counts,
    ...periodTotals(7),
    series: series(7),
    updatedAt: nowIso(),
  };
}

function adminOverview() {
  const counts = get(
    `SELECT
       (SELECT COUNT(*) FROM drops) AS allDrops,
       (SELECT COUNT(*) FROM drops WHERE status = 'published') AS published,
       (SELECT COUNT(*) FROM drops WHERE status = 'draft') AS drafts,
       (SELECT COALESCE(SUM(views), 0)  FROM drops) AS totalViews,
       (SELECT COALESCE(SUM(clicks), 0) FROM drops) AS totalClicks,
       (SELECT COUNT(*) FROM visitors) AS totalVisitors,
       (SELECT COUNT(*) FROM categories) AS categories`
  );
  const week = periodTotals(7);
  const prevStart = new Date();
  prevStart.setUTCHours(0, 0, 0, 0);
  prevStart.setUTCDate(prevStart.getUTCDate() - 13);
  const previous = get(
    `SELECT
       SUM(CASE WHEN type = 'view'  THEN 1 ELSE 0 END) AS views,
       SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks,
       SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits
     FROM events WHERE day >= ? AND day < ?`,
    prevStart.toISOString().slice(0, 10),
    new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
  );
  return {
    ...counts,
    week,
    previous,
    series: series(14),
    topDrops: all(
      `SELECT id, slug, title, views, clicks, thumbnail, status, category_id
         FROM drops WHERE status = 'published'
        ORDER BY views DESC, clicks DESC LIMIT 5`
    ),
    recent: recentEvents(8),
    categories: categoryStats(),
  };
}

function categoryStats() {
  return all(
    `SELECT c.id, c.slug, c.name, c.accent, c.icon,
            COUNT(d.id) AS drops,
            COALESCE(SUM(d.views), 0) AS views,
            COALESCE(SUM(d.clicks), 0) AS clicks
       FROM categories c
       LEFT JOIN drops d ON d.category_id = c.id AND d.status = 'published'
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`
  );
}

function popularDrops(limit = 5) {
  return all(
    `SELECT d.id, d.slug, d.title, d.description, d.thumbnail, d.views, d.clicks,
            d.published_at, c.name AS category, c.slug AS category_slug, c.accent AS category_accent
       FROM drops d JOIN categories c ON c.id = d.category_id
      WHERE d.status = 'published'
      ORDER BY d.views DESC, d.clicks DESC, d.published_at DESC
      LIMIT ?`,
    limit
  );
}

function recentEvents(limit = 10) {
  return all(
    `SELECT e.id, e.type, e.day, e.created_at, e.device, e.path,
            d.title AS drop_title, d.slug AS drop_slug, c.name AS category
       FROM events e
       LEFT JOIN drops d ON d.id = e.drop_id
       LEFT JOIN categories c ON c.id = e.category_id
      ORDER BY e.created_at DESC
      LIMIT ?`,
    limit
  );
}

function topDropsInRange(days = 30, limit = 8) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return all(
    `SELECT d.id, d.slug, d.title, d.status, d.thumbnail, c.name AS category, c.accent AS category_accent,
            SUM(CASE WHEN e.type = 'view'  THEN 1 ELSE 0 END) AS views,
            SUM(CASE WHEN e.type = 'click' THEN 1 ELSE 0 END) AS clicks
       FROM events e
       JOIN drops d ON d.id = e.drop_id
       JOIN categories c ON c.id = d.category_id
      WHERE e.day >= ?
      GROUP BY d.id
      ORDER BY views DESC, clicks DESC
      LIMIT ?`,
    start.toISOString().slice(0, 10),
    limit
  );
}

function deviceBreakdown(days = 30) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return all(
    `SELECT COALESCE(device, 'desktop') AS device, COUNT(*) AS total
       FROM events WHERE day >= ? AND type = 'visit'
      GROUP BY device ORDER BY total DESC`,
    start.toISOString().slice(0, 10)
  );
}

function referrerBreakdown(days = 30, limit = 6) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return all(
    `SELECT COALESCE(referrer, 'direct') AS source, COUNT(*) AS total
       FROM events WHERE day >= ? AND type = 'visit'
      GROUP BY referrer ORDER BY total DESC LIMIT ?`,
    start.toISOString().slice(0, 10),
    limit
  );
}

function bucketSeries(days = 90, granularity = 'week') {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const format = granularity === 'month' ? '%Y-%m' : '%Y-%W';
  return all(
    `SELECT MIN(day) AS start, MAX(day) AS end,
            SUM(CASE WHEN type = 'view'  THEN 1 ELSE 0 END) AS views,
            SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks,
            SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits
       FROM events
      WHERE day >= ?
      GROUP BY strftime(?, day)
      ORDER BY MIN(day) ASC`,
    start.toISOString().slice(0, 10),
    format
  );
}

function dropStats(dropId, days = 30) {
  const totals = get(
    `SELECT d.id, d.slug, d.title, d.status, d.views, d.clicks, d.published_at, d.created_at,
            c.name AS category, c.accent AS category_accent
       FROM drops d JOIN categories c ON c.id = d.category_id
      WHERE d.id = ?`,
    dropId
  );
  if (!totals) return null;
  const range = get(
    `SELECT SUM(CASE WHEN type = 'view' THEN 1 ELSE 0 END) AS views,
            SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks
       FROM events WHERE drop_id = ? AND day >= date('now', ?)`,
    dropId,
    `-${days} days`
  );
  return {
    ...totals,
    range,
    series: series(days, dropId),
    lastEvents: all(
      `SELECT type, day, created_at FROM events WHERE drop_id = ? ORDER BY created_at DESC LIMIT 10`,
      dropId
    ),
  };
}

module.exports = {
  deviceFromUa,
  referrerHost,
  trackVisit,
  recordView,
  recordClick,
  series,
  periodTotals,
  publicOverview,
  adminOverview,
  categoryStats,
  popularDrops,
  recentEvents,
  topDropsInRange,
  deviceBreakdown,
  referrerBreakdown,
  bucketSeries,
  dropStats,
};
