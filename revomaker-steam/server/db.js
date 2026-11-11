'use strict';

/**
 * SQLite persistence layer — powered by Node's built-in `node:sqlite`.
 * No native modules, no external dependencies.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const config = require('./config');

const db = new DatabaseSync(config.DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'owner',
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL,
    last_login_at TEXT
  );

  DROP TRIGGER IF EXISTS trg_users_limit;
  CREATE TRIGGER trg_users_limit
  BEFORE INSERT ON users
  WHEN (SELECT COUNT(*) FROM users) >= 3
  BEGIN
    SELECT RAISE(ABORT, 'owner_limit_reached');
  END;

  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash  TEXT    NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    ip_hash     TEXT,
    user_agent  TEXT,
    revoked_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    accent      TEXT    NOT NULL DEFAULT '#8B5CF6',
    icon        TEXT    NOT NULL DEFAULT 'grid',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drops (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    thumbnail     TEXT,
    external_url  TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('published','draft')),
    featured      INTEGER NOT NULL DEFAULT 0,
    views         INTEGER NOT NULL DEFAULT 0,
    clicks        INTEGER NOT NULL DEFAULT 0,
    published_at  TEXT,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_drops_status      ON drops(status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_drops_category    ON drops(category_id, status);
  CREATE INDEX IF NOT EXISTS idx_drops_featured    ON drops(featured, status);

  CREATE TABLE IF NOT EXISTS visitors (
    id         TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    device     TEXT,
    referrer   TEXT,
    visits     INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_visitors_seen ON visitors(last_seen);

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK (type IN ('view','click','visit')),
    drop_id     INTEGER REFERENCES drops(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    visitor_id  TEXT,
    path        TEXT,
    referrer    TEXT,
    device      TEXT,
    day         TEXT    NOT NULL,
    created_at  TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_day      ON events(day);
  CREATE INDEX IF NOT EXISTS idx_events_type_day ON events(type, day);
  CREATE INDEX IF NOT EXISTS idx_events_drop     ON events(drop_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_throttle ON events(visitor_id, drop_id, type, created_at);

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT    NOT NULL,
    entity     TEXT,
    entity_id  INTEGER,
    detail     TEXT,
    ip_hash    TEXT,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

  CREATE TABLE IF NOT EXISTS auth_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash    TEXT    NOT NULL,
    email_hash TEXT,
    success    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_ip ON auth_attempts(ip_hash, created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const nowIso = () => new Date().toISOString();
const dayOf = (date = new Date()) => date.toISOString().slice(0, 10);
const daysAgo = (n, hour = 12) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Seed defaults
 * ------------------------------------------------------------------ */

const DEFAULT_CATEGORIES = [
  {
    slug: 'steam',
    name: 'STEAM',
    description:
      'Drops that live on Steam — demo keys, free weekends, workshop kits and official store discoveries.',
    accent: '#38BDF8',
    icon: 'steam',
    sort_order: 1,
  },
  {
    slug: 'xbox',
    name: 'XBOX',
    description:
      'Game Pass perks, seasonal rewards and official Xbox destinations, curated for console players.',
    accent: '#22C55E',
    icon: 'xbox',
    sort_order: 2,
  },
  {
    slug: 'cookies',
    name: 'COOKIES',
    description:
      'Cookie-safety documentation and harmless downloadable text resources. We never list credentials, session tokens or authentication cookies.',
    accent: '#F59E0B',
    icon: 'cookie',
    sort_order: 3,
  },
  {
    slug: 'other',
    name: 'OTHER',
    description:
      'Community tools, wallpaper vaults, templates and everything that does not fit the other lanes.',
    accent: '#A855F7',
    icon: 'grid',
    sort_order: 4,
  },
];

const DEMO_DROPS = [
  {
    slug: 'chromatic-drift-demo-key',
    title: 'Chromatic Drift — Demo Key Drop',
    description:
      'Get instant access to the Chromatic Drift demo build on Steam. A neon arcade racer with synthwave tracks, ghost leaderboards and a free weekend window. Keys are released in waves on the official store page.',
    category: 'steam',
    thumbnail: '/assets/drops/chromatic-drift.svg',
    url: 'https://store.steampowered.com/',
    featured: 1,
    status: 'published',
    days: 1,
  },
  {
    slug: 'steam-replay-year-in-gaming',
    title: 'Steam Replay — Your Year in Gaming',
    description:
      'Unlock a personalised recap of every hour you sank into your Steam library this year. Track playtime milestones, rarest achievements and the genres that owned your weekends.',
    category: 'steam',
    thumbnail: '/assets/drops/steam-replay.svg',
    url: 'https://store.steampowered.com/',
    featured: 0,
    status: 'published',
    days: 3,
  },
  {
    slug: 'neon-circuit-free-weekend',
    title: 'Neon Circuit — Free Weekend Vault',
    description:
      'The full Neon Circuit track pack is free to play this weekend. Claim the event loot, test every chassis and keep the exclusive neon livery before the vault closes.',
    category: 'steam',
    thumbnail: '/assets/drops/neon-circuit.svg',
    url: 'https://store.steampowered.com/',
    featured: 0,
    status: 'published',
    days: 6,
  },
  {
    slug: 'pixel-forge-workshop-kit',
    title: 'Pixel Forge — Workshop Starter Kit',
    description:
      'A curated starter kit for creators: tile palettes, animation sheets and a publishing checklist that takes your first Steam Workshop item from sketch to release.',
    category: 'steam',
    thumbnail: '/assets/drops/pixel-forge.svg',
    url: 'https://steamcommunity.com/workshop/',
    featured: 0,
    status: 'published',
    days: 11,
  },
  {
    slug: 'game-pass-monthly-perk-pack',
    title: 'Game Pass Monthly — Perk Pack',
    description:
      'This month\'s Game Pass perks have landed: in-game currency bundles, cosmetic packs and member-only trials. Redeem each perk from the official Xbox dashboard before it rotates out.',
    category: 'xbox',
    thumbnail: '/assets/drops/game-pass.svg',
    url: 'https://www.xbox.com/en-US/xbox-game-pass',
    featured: 1,
    status: 'published',
    days: 2,
  },
  {
    slug: 'halo-infinite-field-guide',
    title: 'Halo Infinite — Season Field Guide',
    description:
      'A spoiler-free field guide to the current Halo Infinite season: new arena layouts, ranked placement tips and the fastest route through the battle pass.',
    category: 'xbox',
    thumbnail: '/assets/drops/halo-season.svg',
    url: 'https://www.xbox.com/en-US/games/halo-infinite',
    featured: 0,
    status: 'published',
    days: 8,
  },
  {
    slug: 'forza-livery-blueprint',
    title: 'Forza Horizon — Livery Blueprint',
    description:
      'Download-ready livery blueprints for the latest Forza Horizon festival season. Layer maps, paint codes and share codes included — remix them for your own garage.',
    category: 'xbox',
    thumbnail: '/assets/drops/forza-livery.svg',
    url: 'https://www.xbox.com/en-US/games/forza-horizon-5',
    featured: 0,
    status: 'published',
    days: 14,
  },
  {
    slug: 'cookie-hygiene-handbook',
    title: 'Cookie Hygiene Handbook',
    description:
      'A plain-language handbook on browser cookies: what they are, which ones are safe, how to audit them and how to clean up your browser in five minutes. Documentation only — no credentials, no session tokens.',
    category: 'cookies',
    thumbnail: '/assets/drops/cookie-handbook.svg',
    url: 'https://www.allaboutcookies.org/',
    featured: 1,
    status: 'published',
    days: 4,
  },
  {
    slug: 'consent-banner-ux-checklist',
    title: 'Consent Banner UX Checklist',
    description:
      'A printable checklist for designing cookie consent banners that are honest, accessible and compliant. Built for indie game studios and community sites.',
    category: 'cookies',
    thumbnail: '/assets/drops/consent-checklist.svg',
    url: 'https://gdpr.eu/cookies/',
    featured: 0,
    status: 'published',
    days: 9,
  },
  {
    slug: 'privacy-first-analytics-guide',
    title: 'Privacy-First Analytics Guide',
    description:
      'Learn how modern sites measure traffic without fingerprinting or invasive cookies. A short guide covering cookieless analytics, retention and consent.',
    category: 'cookies',
    thumbnail: '/assets/drops/privacy-analytics.svg',
    url: 'https://plausible.io/privacy-focused-web-analytics',
    featured: 0,
    status: 'published',
    days: 19,
  },
  {
    slug: 'creator-wallpaper-vault-vol-1',
    title: 'Creator Wallpaper Vault — Vol. 1',
    description:
      'A free 4K wallpaper collection for your setup: neon cityscapes, abstract hardware macros and moody key art. Licensed for personal use.',
    category: 'other',
    thumbnail: '/assets/drops/wallpaper-vault.svg',
    url: 'https://unsplash.com/wallpapers',
    featured: 0,
    status: 'published',
    days: 5,
  },
  {
    slug: 'esports-bracket-toolkit',
    title: 'Esports Bracket Toolkit',
    description:
      'Ready-to-print bracket templates for 8, 16 and 32 player tournaments, plus a seeding sheet and a stream overlay guide for community organisers.',
    category: 'other',
    thumbnail: '/assets/drops/bracket-toolkit.svg',
    url: 'https://www.printyourbracket.com/',
    featured: 0,
    status: 'published',
    days: 16,
  },
  {
    slug: 'cloud-gaming-setup-guide',
    title: 'Cloud Gaming — Setup Guide',
    description:
      'Draft: a step-by-step guide to streaming your Xbox library to handhelds and TVs, including network tuning and controller pairing.',
    category: 'xbox',
    thumbnail: '/assets/drops/cloud-gaming.svg',
    url: 'https://www.xbox.com/en-US/play',
    featured: 0,
    status: 'draft',
    days: 0,
  },
];

function seed() {
  const categoryCount = get('SELECT COUNT(*) AS c FROM categories').c;
  if (categoryCount === 0) {
    const now = nowIso();
    for (const cat of DEFAULT_CATEGORIES) {
      run(
        `INSERT INTO categories (slug, name, description, accent, icon, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        cat.slug,
        cat.name,
        cat.description,
        cat.accent,
        cat.icon,
        cat.sort_order,
        now,
        now
      );
    }
  }

  if (!config.SEED_DEMO) return;
  const dropCount = get('SELECT COUNT(*) AS c FROM drops').c;
  if (dropCount > 0) return;

  tx(() => {
    for (const item of DEMO_DROPS) {
      const cat = get('SELECT id FROM categories WHERE slug = ?', item.category);
      if (!cat) continue;
      const created = daysAgo(item.days + 1, 9);
      const published = item.status === 'published' ? daysAgo(item.days, 10) : null;
      run(
        `INSERT INTO drops
          (slug, title, description, category_id, thumbnail, external_url, status, featured,
           views, clicks, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        item.slug,
        item.title,
        item.description,
        cat.id,
        item.thumbnail,
        item.url,
        item.status,
        item.featured,
        published,
        created,
        published || created
      );
    }
  });
}

seed();

module.exports = {
  db,
  run,
  get,
  all,
  tx,
  nowIso,
  dayOf,
  daysAgo,
  DEFAULT_CATEGORIES,
};
