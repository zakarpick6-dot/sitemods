# Deploying REVOMAKER STEAM

This project is **not a static website**. It is a stateful Node server:

- SQLite database via `node:sqlite` (`data/revomaker.sqlite`)
- uploaded images in `data/uploads/`
- sessions, analytics and owner accounts in that same database
- a long-running HTTP process with in-memory rate limiting

Because of that, the host must provide a **persistent disk**. Vercel's serverless
functions do not, so the current app cannot run there unchanged. The table below
summarises the options.

| Host | Works as-is? | Notes |
| --- | --- | --- |
| Render / Railway / Fly.io with a volume | Yes | Recommended. No code changes. |
| VPS + nginx/Caddy | Yes | Full control. |
| Vercel | No | Functions are stateless; SQLite and uploads reset. |

---

## 1. Push the project to GitHub

```bash
cd revomaker-steam
git init -b main
git config user.name "Your Name"
git config user.email "you@example.com"
git add .
git commit -m "REVOMAKER STEAM"
```

Create an **empty** repository on <https://github.com/new> (do not add a README),
then connect it:

```bash
git remote add origin https://github.com/YOUR-USERNAME/revomaker-steam.git
git push -u origin main
```

`.gitignore` already excludes the files that must never be committed:

```text
data/
.env
.owner-credentials.txt
node_modules/
```

Verify before pushing:

```bash
git status --short
```

If `.env`, `data/` or `.owner-credentials.txt` appear, stop and fix `.gitignore`.
Because the credentials file exists locally, delete it after storing the passwords
in a password manager.

---

## 2. Deploy to Render (recommended)

Render supports a persistent disk and runs the existing `npm start` command.

### Create the service

1. In Render: **New → Web Service**, connect the GitHub repo.
2. **Runtime:** Node
3. **Build command:** `npm install`
4. **Start command:** `npm start`
5. Choose an instance type that supports disks (Starter or higher).

### Add a persistent disk

- **Name:** `data`
- **Mount path:** `/opt/render/project/src/data`
- **Size:** 1 GB is plenty

Mounting the disk at `data` keeps both the SQLite file and uploaded images.
No code changes are needed.

### Environment variables

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `24` (or the latest 24.x your host provides) |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://YOUR-SERVICE.onrender.com` |
| `APP_SECRET` | 64+ random hex characters |
| `COOKIE_SECURE` | `1` |
| `TRUST_PROXY` | `1` |
| `SEED_DEMO` | `0` |

Generate the secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`SEED_DEMO=0` still creates the four categories; it only skips the demo drop
catalogue. Leave it at `1` if you want the demo drops in production.

### First deploy

After the deploy finishes, open:

```text
https://YOUR-SERVICE.onrender.com/api/health
```

You should get `{"ok":true,...}`.

### Create the three owner accounts

Open the Render **Shell** for the service and run:

```bash
npm run owners create -- --email owner@revomaker.steam --name "Zak" --password "REPLACE_WITH_STRONG_PASSWORD"
npm run owners create -- --email coowner@revomaker.steam --name "Co-Owner" --password "REPLACE_WITH_STRONG_PASSWORD"
npm run owners create -- --email third@revomaker.steam --name "Third Owner" --password "REPLACE_WITH_STRONG_PASSWORD"
npm run owners list
```

The limit is enforced by a database trigger, so the fourth account will fail.
Sign in at `https://YOUR-SERVICE.onrender.com/admin/login`.

### Custom domain

1. Add the domain in Render → **Settings → Custom Domains**.
2. Change `APP_URL` to `https://your-domain.example`.
3. Redeploy so cookies, canonical URLs and the sitemap use the new origin.

### Backups

Back up the whole disk, or at least:

```text
data/revomaker.sqlite
data/uploads/
```

Render can take disk snapshots; keep them enabled.

---

## 3. Railway (also works)

1. **New Project → Deploy from GitHub repo.**
2. Add a **Volume** mounted at `/app/data`.
3. Set the same environment variables as above.
4. Use the service shell to run the three `npm run owners create` commands.

Railway's build uses the `engines` field in `package.json`; Node 24 is selected
automatically. If not, set `NODE_VERSION=24`.

---

## 4. Fly.io (also works)

```bash
fly launch --no-deploy
fly volumes create data --size 1
```

In `fly.toml` mount the volume at the app's `data` directory (match the app root
created by `fly launch`, commonly `/app/data`):

```toml
[mounts]
  source = "data"
  destination = "/app/data"
```

Set the same secrets:

```bash
fly secrets set APP_URL=https://your-app.fly.dev APP_SECRET=... COOKIE_SECURE=1 TRUST_PROXY=1 SEED_DEMO=0
fly deploy
fly ssh console -C "npm run owners list"
```

---

## 5. Vercel

### Why it does not work as-is

- Serverless functions have a **read-only filesystem** except `/tmp`.
- `/tmp` is per-instance and **not persistent**; every cold start or new instance
  gets its own empty SQLite database.
- Uploads are stored on disk, so they disappear the same way.
- Upload requests are base64 JSON around 5.3 MB; Vercel caps request bodies at
  about 4.5 MB.
- In-memory rate limiting is per instance, not global.

A Vercel deploy of this repo would lose the owner accounts, drops, uploads and
analytics, and the owner console would be unreliable.

### Option A — static preview only

You can deploy **only** the `public/` folder to Vercel as a visual demo:

```bash
npx vercel --prod
```

When asked for the output directory, choose `public`. This gives you the design
and static pages, but **not**:

- `/api/*` endpoints
- `/go/:slug` tracked redirects
- search, filtering and live statistics
- the owner console and authentication
- per-drop SEO/Open Graph injection

Use this only to show the design, not as the production site.

### Option B — full Vercel migration (code changes required)

To run the real app on Vercel you would need to:

1. Refactor `server/index.js` so it exports a request handler and only calls
   `listen()` when run directly.
2. Add `api/index.js` (serverless adapter) and `vercel.json` rewrites for
   `/api/*`, `/go/*`, `/admin`, `/category/*`, `/drop/*` and the HTML pages.
3. Move the database to a hosted service:
   - **Turso** (hosted SQLite, closest fit) or
   - **Neon / Vercel Postgres**.
   This means replacing the synchronous `node:sqlite` calls in `server/db.js`
   and updating every route to async queries.
4. Move uploads to **Vercel Blob** or S3 and upload directly from the browser
   (to stay under the 4.5 MB function body limit).
5. Move rate limiting to Upstash Redis (optional, but recommended).
6. Provision the three owners against the hosted database.

That is a meaningful rewrite, not a configuration change. If you want the app on
Vercel specifically, this is the path — otherwise use Render/Railway/Fly.

---

## 6. Post-deploy checklist

- `GET /api/health` returns `ok: true`
- `GET /api/setup-status` returns `owners: 3, limit: 3, ready: true`
- `/admin/login` loads over HTTPS and the session cookie is `Secure; HttpOnly`
- `npm run owners list` shows exactly three accounts
- `robots.txt` and `sitemap.xml` use the production domain
- demo traffic cleared before launch (`npm run reset:stats`)
- `.owner-credentials.txt` deleted from every machine after storing the passwords
- database + uploads backed up
