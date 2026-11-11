'use strict';

const config = require('../config');
const { HttpError } = require('../http');
const { all, get } = require('../db');
const { getVisitor, appendCookie } = require('../security');
const {
  publicOverview,
  categoryStats,
  popularDrops,
  trackVisit,
  recordView,
  recordClick,
  series,
} = require('../stats');

const SORTS = {
  latest: 'd.published_at DESC, d.id DESC',
  popular: 'd.views DESC, d.clicks DESC, d.published_at DESC',
  views: 'd.views DESC, d.published_at DESC',
  clicks: 'd.clicks DESC, d.published_at DESC',
  az: 'd.title COLLATE NOCASE ASC',
};

function serialize(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    thumbnail: row.thumbnail,
    externalUrl: row.external_url ?? undefined,
    views: row.views,
    clicks: row.clicks,
    featured: Boolean(row.featured),
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: {
      id: row.category_id,
      slug: row.category_slug,
      name: row.category_name,
      accent: row.category_accent,
      icon: row.category_icon,
    },
  };
}

const SELECT_DROP = `
  SELECT d.*, c.slug AS category_slug, c.name AS category_name,
         c.accent AS category_accent, c.icon AS category_icon
    FROM drops d
    JOIN categories c ON c.id = d.category_id`;

function listDrops(query) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit || '9', 10) || 9, 1), 24);
  const page = Math.max(Number.parseInt(query.page || '1', 10) || 1, 1);
  const offset = (page - 1) * limit;
  const where = ["d.status = 'published'"];
  const params = [];

  if (query.category) {
    const category = get('SELECT slug FROM categories WHERE slug = ?', String(query.category));
    if (!category) throw new HttpError(404, 'Category not found.', { code: 'category_not_found' });
    where.push('c.slug = ?');
    params.push(category.slug);
  }
  if (query.q) {
    const term = String(query.q).trim().slice(0, 80);
    if (term) {
      const escaped = term.replace(/[\\%_]/g, '\\$&');
      where.push("(d.title LIKE ? ESCAPE '\\' OR d.description LIKE ? ESCAPE '\\')");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
  }
  if (query.featured === '1' || query.featured === 'true') {
    where.push('d.featured = 1');
  }
  const whereSql = where.join(' AND ');
  const order = SORTS[query.sort] || SORTS.latest;
  const total = get(
    `SELECT COUNT(*) AS c FROM drops d JOIN categories c ON c.id = d.category_id WHERE ${whereSql}`,
    ...params
  ).c;
  const rows = all(
    `${SELECT_DROP} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  return {
    drops: rows.map(serialize),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    hasMore: page * limit < total,
    limit,
  };
}

function dropBySlug(slug) {
  const row = get(`${SELECT_DROP} WHERE d.slug = ? AND d.status = 'published'`, slug);
  if (!row) throw new HttpError(404, 'Drop not found.', { code: 'drop_not_found' });
  return row;
}

function detail(slug) {
  const row = dropBySlug(slug);
  const related = all(
    `${SELECT_DROP} WHERE d.status = 'published' AND d.id <> ? AND d.category_id = ?
     ORDER BY d.views DESC LIMIT 4`,
    row.id,
    row.category_id
  ).map(serialize);
  return {
    drop: { ...serialize(row), externalHost: new URL(row.external_url).hostname.replace(/^www\./, '') },
    related,
  };
}

function visitorTracking(req, res) {
  const visitor = getVisitor(req);
  if (visitor.cookie) appendCookie(res, visitor.cookie);
  return visitor;
}

const routes = [
  /* ------------------------- public data ------------------------- */
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: (ctx) => {
      ctx.json(200, {
        ok: true,
        service: 'revomaker-steam',
        version: '1.0.0',
        uptime: Math.round((Date.now() - require('../config').STARTED_AT) / 1000),
        time: new Date().toISOString(),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/stats\/overview$/,
    handler: (ctx) => ctx.json(200, publicOverview()),
  },
  {
    method: 'GET',
    pattern: /^\/api\/setup-status$/,
    handler: (ctx) => {
      const owners = get('SELECT COUNT(*) AS c FROM users').c;
      ctx.json(200, { owners, limit: config.OWNER_LIMIT, ready: owners > 0 });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/categories$/,
    handler: (ctx) => ctx.json(200, { categories: categoryStats() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/drops$/,
    handler: (ctx) => ctx.json(200, listDrops(ctx.query)),
  },
  {
    method: 'GET',
    pattern: /^\/api\/drops\/([a-z0-9-]{1,80})$/,
    handler: (ctx, slug) => ctx.json(200, detail(slug)),
  },
  {
    method: 'GET',
    pattern: /^\/api\/popular$/,
    handler: (ctx) => {
      const limit = Math.min(Math.max(Number.parseInt(ctx.query.limit || '5', 10) || 5, 1), 10);
      ctx.json(200, { drops: popularDrops(limit) });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/activity$/,
    handler: (ctx) => {
      const days = Math.min(Math.max(Number.parseInt(ctx.query.days || '14', 10) || 14, 7), 30);
      ctx.json(200, { series: series(days) });
    },
  },

  /* ------------------------- tracking ------------------------- */
  {
    method: 'POST',
    pattern: /^\/api\/visit$/,
    bodyLimit: 4096,
    handler: (ctx) => {
      const visitor = visitorTracking(ctx.req, ctx.res);
      const payload = ctx.body || {};
      const result = trackVisit({
        visitorId: visitor.id,
        path: payload.path || '/',
        referrer: ctx.req.headers.referer || payload.referrer,
        ua: ctx.req.headers['user-agent'],
      });
      ctx.json(200, { ok: true, ...result });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/drops\/([a-z0-9-]{1,80})\/view$/,
    bodyLimit: 2048,
    handler: (ctx, slug) => {
      const drop = dropBySlug(slug);
      const visitor = visitorTracking(ctx.req, ctx.res);
      const result = recordView(drop, visitor.id);
      ctx.json(200, { ok: true, ...result });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/drops\/([a-z0-9-]{1,80})\/click$/,
    bodyLimit: 2048,
    handler: (ctx, slug) => {
      const drop = dropBySlug(slug);
      const visitor = visitorTracking(ctx.req, ctx.res);
      const result = recordClick(drop, visitor.id);
      ctx.json(200, {
        ok: true,
        ...result,
        url: drop.external_url,
        title: drop.title,
        host: new URL(drop.external_url).hostname.replace(/^www\./, ''),
      });
    },
  },
];

module.exports = { routes, listDrops, detail, dropBySlug, serialize, visitorTracking };
