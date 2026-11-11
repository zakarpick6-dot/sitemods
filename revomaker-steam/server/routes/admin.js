'use strict';

const config = require('../config');
const { HttpError } = require('../http');
const { get, all, run, tx, nowIso } = require('../db');
const { audit } = require('../security');
const { saveDataUrl, deleteUpload } = require('../uploads');
const {
  cleanText,
  slugify,
  validateHttpUrl,
  assertCookieSafe,
  validateCategoryInput,
} = require('../validation');
const {
  adminOverview,
  series,
  bucketSeries,
  topDropsInRange,
  deviceBreakdown,
  referrerBreakdown,
  categoryStats,
  recentEvents,
  dropStats,
  periodTotals,
} = require('../stats');

const FALLBACK = (slug) => `/assets/drops/fallback-${slug}.svg`;

const SELECT_ADMIN_DROP = `
  SELECT d.*, c.slug AS category_slug, c.name AS category_name,
         c.accent AS category_accent, c.icon AS category_icon
    FROM drops d JOIN categories c ON c.id = d.category_id`;

function serializeAdmin(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    thumbnail: row.thumbnail,
    externalUrl: row.external_url,
    status: row.status,
    featured: Boolean(row.featured),
    views: row.views,
    clicks: row.clicks,
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

function uniqueDropSlug(base, excludeId) {
  let slug = slugify(base) || 'drop';
  if (slug.length < 3) slug = `drop-${slug}`.slice(0, 64);
  let candidate = slug;
  let n = 2;
  for (;;) {
    const existing = excludeId
      ? get('SELECT id FROM drops WHERE slug = ? AND id <> ?', candidate, excludeId)
      : get('SELECT id FROM drops WHERE slug = ?', candidate);
    if (!existing) return candidate;
    candidate = `${slug.slice(0, 58)}-${n}`;
    n += 1;
    if (n > 500) throw new HttpError(409, 'Could not generate a unique slug.', { code: 'slug_taken' });
  }
}

function resolveCategory(value) {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(422, 'Choose a category.', { field: 'category' });
  }
  const category = get('SELECT * FROM categories WHERE slug = ?', String(value).trim().toLowerCase());
  if (!category) throw new HttpError(422, 'That category does not exist.', { field: 'category' });
  return category;
}

function normalizeDropInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = cleanText(body.title, { min: 3, max: 100, label: 'Title' });
  }
  if (!partial || body.description !== undefined) {
    out.description = cleanText(body.description, {
      min: 20,
      max: 1500,
      multiline: true,
      label: 'Description',
    });
  }
  if (!partial || body.externalUrl !== undefined) {
    out.externalUrl = validateHttpUrl(body.externalUrl);
  }
  if (!partial || body.category !== undefined) {
    out.category = resolveCategory(body.category);
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!['published', 'draft'].includes(status)) {
      throw new HttpError(422, 'Status must be published or draft.', { field: 'status' });
    }
    out.status = status;
  }
  if (body.featured !== undefined) {
    out.featured = Boolean(body.featured) ? 1 : 0;
  }
  if (body.removeThumbnail) out.removeThumbnail = true;
  if (typeof body.thumbnail === 'string' && body.thumbnail.startsWith('data:')) {
    out.thumbnailData = body.thumbnail;
  } else if (typeof body.thumbnail === 'string' && /^\/assets\/drops\/[a-z0-9-]+\.svg$/i.test(body.thumbnail)) {
    out.thumbnail = body.thumbnail;
  }
  if (body.slug !== undefined && body.slug !== '') {
    const slug = slugify(body.slug);
    if (!slug || slug.length < 3) {
      throw new HttpError(422, 'Slug must contain at least 3 letters or numbers.', { field: 'slug' });
    }
    out.slugBase = slug;
  }
  return out;
}

function cookiePolicyCheck(title, description, url, categorySlug) {
  if (categorySlug === 'cookies') assertCookieSafe(title, description, url);
}

/* ------------------------------------------------------------------ */

const routes = [
  {
    method: 'GET',
    pattern: /^\/api\/admin\/overview$/,
    auth: true,
    handler: (ctx) => ctx.json(200, adminOverview()),
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/analytics$/,
    auth: true,
    handler: (ctx) => {
      const days = [7, 30, 90].includes(Number(ctx.query.days)) ? Number(ctx.query.days) : 30;
      const totals = periodTotals(days);
      const visitors = get(
        `SELECT COUNT(DISTINCT visitor_id) AS c FROM events
          WHERE type = 'visit' AND day >= date('now', ?)`,
        `-${days} days`
      ).c;
      ctx.json(200, {
        days,
        totals: {
          views: totals.views || 0,
          clicks: totals.clicks || 0,
          visits: totals.visits || 0,
          visitors,
          ctr: totals.views ? Number(((totals.clicks || 0) / totals.views) * 100) : 0,
        },
        allTime: get(
          `SELECT COALESCE(SUM(views), 0) AS views,
                  COALESCE(SUM(clicks), 0) AS clicks,
                  (SELECT COUNT(*) FROM visitors) AS visitors
             FROM drops`
        ),
        series: series(days),
        weekly: bucketSeries(Math.min(90, Math.max(days, 30)), 'week'),
        monthly: bucketSeries(365, 'month'),
        topDrops: topDropsInRange(days, 10),
        devices: deviceBreakdown(days),
        referrers: referrerBreakdown(days),
        categories: categoryStats(),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/drops$/,
    auth: true,
    handler: (ctx) => {
      const limit = Math.min(Math.max(Number.parseInt(ctx.query.limit || '8', 10) || 8, 1), 50);
      const page = Math.max(Number.parseInt(ctx.query.page || '1', 10) || 1, 1);
      const where = [];
      const params = [];
      if (ctx.query.status === 'published' || ctx.query.status === 'draft') {
        where.push('d.status = ?');
        params.push(ctx.query.status);
      }
      if (ctx.query.category) {
        where.push('c.slug = ?');
        params.push(String(ctx.query.category));
      }
      if (ctx.query.q) {
        const term = String(ctx.query.q).trim().slice(0, 80);
        if (term) {
          const escaped = term.replace(/[\\%_]/g, '\\$&');
          where.push("(d.title LIKE ? ESCAPE '\\' OR d.slug LIKE ? ESCAPE '\\')");
          params.push(`%${escaped}%`, `%${escaped}%`);
        }
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = get(
        `SELECT COUNT(*) AS c FROM drops d JOIN categories c ON c.id = d.category_id ${whereSql}`,
        ...params
      ).c;
      const rows = all(
        `${SELECT_ADMIN_DROP} ${whereSql} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        (page - 1) * limit
      );
      ctx.json(200, {
        drops: rows.map(serializeAdmin),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/drops\/(\d{1,12})$/,
    auth: true,
    handler: (ctx, idParam) => {
      const row = get(`${SELECT_ADMIN_DROP} WHERE d.id = ?`, Number(idParam));
      if (!row) throw new HttpError(404, 'Drop not found.', { code: 'drop_not_found' });
      ctx.json(200, { drop: serializeAdmin(row) });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/drops\/(\d{1,12})\/stats$/,
    auth: true,
    handler: (ctx, idParam) => {
      const stats = dropStats(Number(idParam), 30);
      if (!stats) throw new HttpError(404, 'Drop not found.', { code: 'drop_not_found' });
      ctx.json(200, stats);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/drops$/,
    auth: true,
    csrf: true,
    bodyLimit: 8 * 1024 * 1024,
    handler: (ctx) => {
      const input = normalizeDropInput(ctx.body, { partial: false });
      const status = input.status || 'draft';
      const title = input.title;
      const description = input.description;
      const url = input.externalUrl;
      const category = input.category;
      cookiePolicyCheck(title, description, url, category.slug);

      let savedThumbnail = null;
      try {
        if (input.thumbnailData) savedThumbnail = saveDataUrl(input.thumbnailData);
        const thumbnail =
          savedThumbnail?.url || input.thumbnail || FALLBACK(category.slug);
        const slug = uniqueDropSlug(input.slugBase || title);
        const now = nowIso();
        const publishedAt = status === 'published' ? now : null;
        const result = run(
          `INSERT INTO drops
            (slug, title, description, category_id, thumbnail, external_url, status, featured,
             views, clicks, published_at, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
          slug,
          title,
          description,
          category.id,
          thumbnail,
          url,
          status,
          input.featured || 0,
          publishedAt,
          now,
          now,
          ctx.auth.user.id,
          ctx.auth.user.id
        );
        const id = Number(result.lastInsertRowid);
        audit(ctx.auth, 'drop_created', 'drop', id, title, ctx.req);
        const row = get(`${SELECT_ADMIN_DROP} WHERE d.id = ?`, id);
        ctx.json(201, { ok: true, drop: serializeAdmin(row) });
      } catch (error) {
        if (savedThumbnail) deleteUpload(savedThumbnail.url);
        throw error;
      }
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/admin\/drops\/(\d{1,12})$/,
    auth: true,
    csrf: true,
    bodyLimit: 8 * 1024 * 1024,
    handler: (ctx, idParam) => {
      const id = Number(idParam);
      const existing = get(`${SELECT_ADMIN_DROP} WHERE d.id = ?`, id);
      if (!existing) throw new HttpError(404, 'Drop not found.', { code: 'drop_not_found' });

      const input = normalizeDropInput(ctx.body, { partial: true });
      const title = input.title ?? existing.title;
      const description = input.description ?? existing.description;
      const url = input.externalUrl ?? existing.external_url;
      const category = input.category ?? {
        id: existing.category_id,
        slug: existing.category_slug,
      };
      const status = input.status ?? existing.status;
      cookiePolicyCheck(title, description, url, category.slug);

      let savedThumbnail = null;
      try {
        if (input.thumbnailData) savedThumbnail = saveDataUrl(input.thumbnailData);
        let thumbnail = existing.thumbnail;
        if (savedThumbnail) thumbnail = savedThumbnail.url;
        else if (input.thumbnail) thumbnail = input.thumbnail;
        else if (input.removeThumbnail) thumbnail = FALLBACK(category.slug);

        const slug =
          input.slugBase && input.slugBase !== existing.slug
            ? uniqueDropSlug(input.slugBase, id)
            : existing.slug;

        const publishedAt =
          status === 'published' ? existing.published_at || nowIso() : existing.published_at;

        run(
          `UPDATE drops SET
             slug = ?, title = ?, description = ?, category_id = ?, thumbnail = ?,
             external_url = ?, status = ?, featured = ?, published_at = ?, updated_at = ?, updated_by = ?
           WHERE id = ?`,
          slug,
          title,
          description,
          category.id,
          thumbnail,
          url,
          status,
          input.featured ?? existing.featured,
          publishedAt,
          nowIso(),
          ctx.auth.user.id,
          id
        );

        if (thumbnail !== existing.thumbnail && existing.thumbnail?.startsWith('/uploads/')) {
          deleteUpload(existing.thumbnail);
        }

        const action =
          existing.status !== status ? (status === 'published' ? 'drop_published' : 'drop_unpublished') : 'drop_updated';
        audit(ctx.auth, action, 'drop', id, title, ctx.req);
        const row = get(`${SELECT_ADMIN_DROP} WHERE d.id = ?`, id);
        ctx.json(200, { ok: true, drop: serializeAdmin(row) });
      } catch (error) {
        if (savedThumbnail) deleteUpload(savedThumbnail.url);
        throw error;
      }
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/drops\/(\d{1,12})$/,
    auth: true,
    csrf: true,
    handler: (ctx, idParam) => {
      const id = Number(idParam);
      const existing = get('SELECT * FROM drops WHERE id = ?', id);
      if (!existing) throw new HttpError(404, 'Drop not found.', { code: 'drop_not_found' });
      tx(() => {
        run('DELETE FROM drops WHERE id = ?', id);
      });
      if (existing.thumbnail?.startsWith('/uploads/')) deleteUpload(existing.thumbnail);
      audit(ctx.auth, 'drop_deleted', 'drop', id, existing.title, ctx.req);
      ctx.json(200, { ok: true, deleted: id });
    },
  },

  /* ------------------------- categories ------------------------- */
  {
    method: 'GET',
    pattern: /^\/api\/admin\/categories$/,
    auth: true,
    handler: (ctx) => {
      const rows = all(
        `SELECT c.*,
                (SELECT COUNT(*) FROM drops d WHERE d.category_id = c.id) AS total_drops,
                (SELECT COUNT(*) FROM drops d WHERE d.category_id = c.id AND d.status = 'published') AS published_drops,
                (SELECT COALESCE(SUM(d.views), 0) FROM drops d WHERE d.category_id = c.id) AS views
           FROM categories c ORDER BY c.sort_order ASC, c.id ASC`
      );
      ctx.json(200, {
        categories: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          description: row.description,
          accent: row.accent,
          icon: row.icon,
          sortOrder: row.sort_order,
          totalDrops: row.total_drops,
          publishedDrops: row.published_drops,
          views: row.views,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/categories$/,
    auth: true,
    csrf: true,
    bodyLimit: 16 * 1024,
    handler: (ctx) => {
      const input = validateCategoryInput(ctx.body || {});
      const slug = input.slug || slugify(input.name);
      if (!slug || slug.length < 2) {
        throw new HttpError(422, 'Category slug is invalid.', { field: 'slug' });
      }
      if (get('SELECT id FROM categories WHERE slug = ?', slug)) {
        throw new HttpError(409, 'That category slug is already in use.', { field: 'slug' });
      }
      const now = nowIso();
      const maxOrder = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').m;
      const result = run(
        `INSERT INTO categories (slug, name, description, accent, icon, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        slug,
        input.name,
        input.description,
        input.accent,
        input.icon,
        maxOrder + 1,
        now,
        now
      );
      audit(ctx.auth, 'category_created', 'category', Number(result.lastInsertRowid), input.name, ctx.req);
      ctx.json(201, { ok: true, id: Number(result.lastInsertRowid) });
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/admin\/categories\/(\d{1,12})$/,
    auth: true,
    csrf: true,
    bodyLimit: 16 * 1024,
    handler: (ctx, idParam) => {
      const id = Number(idParam);
      const existing = get('SELECT * FROM categories WHERE id = ?', id);
      if (!existing) throw new HttpError(404, 'Category not found.', { code: 'category_not_found' });
      const input = validateCategoryInput(ctx.body || {}, { partial: true });
      if (input.slug && input.slug !== existing.slug) {
        if (get('SELECT id FROM categories WHERE slug = ? AND id <> ?', input.slug, id)) {
          throw new HttpError(409, 'That category slug is already in use.', { field: 'slug' });
        }
      }
      run(
        `UPDATE categories SET
           slug = ?, name = ?, description = ?, accent = ?, icon = ?, updated_at = ?
         WHERE id = ?`,
        input.slug ?? existing.slug,
        input.name ?? existing.name,
        input.description ?? existing.description,
        input.accent ?? existing.accent,
        input.icon ?? existing.icon,
        nowIso(),
        id
      );
      audit(ctx.auth, 'category_updated', 'category', id, input.name || existing.name, ctx.req);
      ctx.json(200, { ok: true });
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/categories\/(\d{1,12})$/,
    auth: true,
    csrf: true,
    handler: (ctx, idParam) => {
      const id = Number(idParam);
      const existing = get('SELECT * FROM categories WHERE id = ?', id);
      if (!existing) throw new HttpError(404, 'Category not found.', { code: 'category_not_found' });
      const used = get('SELECT COUNT(*) AS c FROM drops WHERE category_id = ?', id).c;
      if (used > 0) {
        throw new HttpError(409, 'Move or delete the drops in this category first.', {
          code: 'category_in_use',
        });
      }
      const total = get('SELECT COUNT(*) AS c FROM categories').c;
      if (total <= 1) {
        throw new HttpError(409, 'At least one category must remain.', { code: 'last_category' });
      }
      run('DELETE FROM categories WHERE id = ?', id);
      audit(ctx.auth, 'category_deleted', 'category', id, existing.name, ctx.req);
      ctx.json(200, { ok: true });
    },
  },

  /* ------------------------- activity / audit ------------------------- */
  {
    method: 'GET',
    pattern: /^\/api\/admin\/activity$/,
    auth: true,
    handler: (ctx) => {
      ctx.json(200, {
        recent: recentEvents(20),
        audit: all(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS owner
             FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.id DESC LIMIT 30`
        ),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/owners$/,
    auth: true,
    handler: (ctx) => {
      const owners = all(
        `SELECT id, name, email, role, created_at, last_login_at FROM users ORDER BY id ASC`
      );
      ctx.json(200, {
        owners: owners.map((owner) => ({
          ...owner,
          current: owner.id === ctx.auth.user.id,
        })),
        limit: config.OWNER_LIMIT,
      });
    },
  },
];

module.exports = { routes, serializeAdmin };
