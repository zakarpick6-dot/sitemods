# REVOMAKER STEAM

A premium gaming **drop** platform: a public, searchable catalogue of hand-curated Steam, Xbox, cookie-safety and community drops, plus a private owner console for publishing and analytics.

- Public storefront: browse, search, filter, view a drop and hit **GET DROP** to open its official destination in a new tab.
- Private console: exactly **three** owner accounts, no public registration, session-based auth, CSRF protection and a shared SQLite database.
- Real statistics only: visitors, drop views, external clicks, per-drop stats and daily/weekly/monthly analytics.
- Zero runtime dependencies: Node's built-in HTTP server, `node:sqlite` and `node:crypto` only.

---

## 1. Requirements

- **Node.js 22.13 or newer** (tested on Node 24.11.1). `node:sqlite` needs 22.13+.
- No `npm install` is required — there are no third-party packages.
- Windows, macOS or Linux.

If Node is not on your PATH, run the commands with the full path to `node`/`npm`, or add its folder to `PATH` for the session.

---

## 2. Quick start

```bash
cd revomaker-steam
cp .env.example .env        # Windows: copy .env.example .env
npm start
```

Open <http://localhost:3000>. The server prints the local URL, admin URL, database path and owner count on boot.

For development with automatic restarts:

```bash
npm run dev
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm start` | Start the production server. |
| `npm run dev` | Start with Node `--watch` (restarts on file changes). |
| `npm run setup` | Interactive first-run provisioning for up to three owners. |
| `npm run owners list` | List owner accounts and the configured limit. |
| `npm run owners create -- --email you@example.com --name "Your Name"` | Create an owner while a slot is open. |
| `npm run owners reset -- --email you@example.com` | Rotate an owner password and revoke their sessions. |
| `npm run owners delete -- --email you@example.com` | Delete an owner account. |
| `npm run owners unlock` | Clear failed sign-in counters. |
| `npm run demo:traffic` | Seed realistic demo views/clicks/visitors for QA. |
| `npm run reset:stats` | Clear tracking events and counters before launch. |
| `npm test` | Run the full integration suite (isolated temp DB). |

> Flags accept both `--email=value` and `--email value`.

---

## 3. Owner accounts (exactly three)

The platform intentionally has **no public registration**. The database trigger `trg_users_limit` rejects a fourth account. Accounts are created from the server CLI:

```bash
npm run setup
```

The walkthrough fills whichever slots are still empty. You can also create one at a time:

```bash
npm run owners create -- --email owner@example.com --name "Owner"
```

If no password is supplied, a strong one is generated and written to `.owner-credentials.txt`. Move those credentials to a password manager and delete the file.

Current provisioned accounts:

| Owner | Email |
| --- | --- |
| Zak | `owner@revomaker.steam` |
| Co-Owner | `coowner@revomaker.steam` |
| Third Owner | `third@revomaker.steam` |

Passwords are stored in `.owner-credentials.txt` in the project root. **Rotate them** with `npm run owners reset -- --email ...` if the file was shared, then delete it.

Owner sign-in: <http://localhost:3000/admin/login>

---

## 4. Project structure

```text
revomaker-steam/
├── server/
│   ├── index.js            # HTTP entry point, routing, page gating, /go/:slug
│   ├── config.js           # .env loader, paths, owner limit, runtime config
│   ├── db.js               # SQLite schema, trigger, seed data
│   ├── security.js         # scrypt hashing, sessions, cookies, CSRF helpers
│   ├── stats.js            # real statistics and analytics queries
│   ├── validation.js       # input, URL and COOKIES guardrails
│   ├── uploads.js          # base64 image storage + magic-byte validation
│   ├── render.js           # per-page SEO/meta/JSON-LD injection
│   ├── static.js           # safe static file serving
│   ├── http.js             # request/response helpers
│   └── routes/
│       ├── public.js       # public APIs, tracking, GET DROP
│       ├── admin.js        # owner CRUD, stats, activity, owners
│       └── auth.js         # sign-in, sign-out, sessions, password change
├── public/
│   ├── index.html          # storefront
│   ├── category.html       # category feed template
│   ├── drop.html           # drop detail template
│   ├── login.html          # owner sign-in
│   ├── admin.html          # private console shell (served only to owners)
│   ├── 404.html
│   ├── assets/
│   │   ├── brand/          # supplied logo, favicon, OG cover
│   │   ├── categories/     # procedural category covers
│   │   ├── drops/          # procedural drop thumbnails
│   │   └── icons.svg
│   ├── css/                # base.css, site.css, admin.css
│   └── js/                 # site, home, category, drop, admin, login
├── scripts/
│   ├── setup.js            # owner provisioning
│   ├── owners.js           # owner list/create/reset/delete/unlock
│   ├── demo-traffic.js     # demo statistics generator
│   ├── reset-stats.js      # clear analytics before launch
│   ├── generate-art.js     # generate SVG drop/category artwork
│   ├── make-brand-assets.ps1
│   └── test.js             # 54-check integration suite
├── data/
│   ├── revomaker.sqlite    # live database (created automatically)
│   └── uploads/            # uploaded thumbnails
├── .env.example
└── package.json
```

---

## 5. Database

- Engine: SQLite through `node:sqlite` (WAL mode, foreign keys on).
- Default path: `data/revomaker.sqlite` (override with `DB_PATH`).
- Tables: `users`, `sessions`, `categories`, `drops`, `view_events`, `click_events`, `visit_events`, `auth_attempts`, `audit_log`.
- First boot seeds four categories (`steam`, `xbox`, `cookies`, `other`) and a demo catalogue of 12 published drops plus one draft.
- To reset **all** data, stop the server and delete `data/revomaker.sqlite` (and its `-wal`/`-shm` files), then restart.

Back up the database and `data/uploads/` together — uploaded thumbnails are stored as files and referenced from the database.

---

## 6. Real statistics

Tracking is first-party and privacy-first; no third-party pixels.

- `POST /api/visit` — page/visitor tracking.
- `POST /api/drops/:slug/view` — deduplicated per visitor window.
- `POST /api/drops/:slug/click` — records a claim and returns the destination.
- `GET /go/:slug` — records the click and redirects to the external URL.

Admin views read live aggregates, not hardcoded counters:

- total drops / views / clicks / visitors;
- views per drop and claim rate;
- popular drops;
- daily/weekly/monthly series;
- device and referrer breakdowns;
- owner audit log.

Before a real launch, clear QA traffic:

```bash
npm run reset:stats
```

To seed demo traffic for a presentation:

```bash
npm run demo:traffic
```

---

## 7. Branding

The supplied artwork `revomaker-logo-4k.png` (white **RV** monogram over the rose/cherry/CD composition) is the canonical server logo. It is used for the header/footer mark, hero artwork and Open Graph cover.

Rebuild raster brand assets from the source image:

```bash
powershell -ExecutionPolicy Bypass -File scripts/make-brand-assets.ps1
```

The script expects the source at `..\revomaker-logo-4k.png` (or inside the project root) and writes:

- `public/assets/brand/logo.png` — 1200×1200 full artwork
- `logo-512.png`, `logo-192.png` — responsive full artwork
- `emblem.png`, `emblem-256.png`, `favicon.png`, `apple-touch-icon.png` — compact monogram crop
- `og-cover.png` — 1200×630 social card

---

## 8. Security model

- Passwords hashed with `scrypt`; plaintext passwords are never stored.
- Session tokens are random, hashed at rest, HttpOnly, `SameSite=Lax`, and become `Secure` when `COOKIE_SECURE=1` or `APP_URL` is HTTPS.
- CSRF token required on every state-changing admin/auth request (`X-CSRF-Token`).
- Origin checks on mutations; strict CSP with a per-request nonce for JSON-LD.
- Rate limiting on general APIs, tracking endpoints and sign-in attempts.
- Upload validation: PNG/JPEG/WebP/GIF only, magic-byte checks, 4 MB cap, randomized filenames.
- External URLs must be HTTP(S) and cannot target private networks.
- The **COOKIES** lane only accepts harmless documentation/text resources. Authentication cookies, session tokens, passwords and credential dumps are rejected by validation.
- Owner count is enforced by a database trigger (three accounts maximum).
- Admin pages are gated server-side; the HTML is never served to anonymous visitors.

---

## 9. Deployment

There is no build step. A single Node process serves the site.

1. Copy the project to the server and install Node.js 22.13+.
2. Create `.env` from `.env.example` and set at minimum:
   ```ini
   NODE_ENV=production
   HOST=127.0.0.1
   PORT=3000
   APP_URL=https://your-domain.example
   COOKIE_SECURE=1
   TRUST_PROXY=1
   ```
3. Provision owners with `npm run setup`.
4. Start the process with your supervisor, for example systemd:
   ```ini
   [Service]
   WorkingDirectory=/srv/revomaker-steam
   ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
   Restart=always
   EnvironmentFile=/srv/revomaker-steam/.env
   ```
5. Put nginx/Caddy/Cloudflare in front, terminate HTTPS and proxy to `127.0.0.1:3000`.
6. Make sure `data/` is writable by the service user and excluded from public file serving.
7. Back up `data/revomaker.sqlite` and `data/uploads/` regularly.

Do not commit `.env`, `data/`, or `.owner-credentials.txt` to source control.

For GitHub + Render/Railway/Fly.io, and for the Vercel limitations and migration
checklist, see [DEPLOY.md](DEPLOY.md).

---

## 10. Testing

```bash
npm test
```

The suite boots an isolated server on a random port with a temporary database, provisions three owners, and covers:

- public pages, APIs, filtering, search and pagination;
- tracking, deduplication and GET DROP redirects;
- auth, session cookies, CSRF and admin gating;
- drop/category CRUD and image uploads;
- COOKIES safety guardrails;
- the three-owner limit and owner security controls.

Expected tail:

```text
54 passed, 0 failed
All integration checks passed.
```

---

## 11. Handy URLs

| URL | Purpose |
| --- | --- |
| `/` | Storefront |
| `/category/steam`, `/category/xbox`, `/category/cookies`, `/category/other` | Category feeds |
| `/drop/:slug` | Drop detail |
| `/go/:slug` | Tracked GET DROP redirect |
| `/admin/login` | Owner sign-in |
| `/admin` | Private console |
| `/api/health` | Service health |
| `/api/setup-status` | Owner provisioning status |
| `/sitemap.xml` | Sitemap |

---

Built for gamers. Owner-controlled. Real numbers only.
