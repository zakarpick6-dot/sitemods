import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
export const sql = neon(process.env.DATABASE_URL);
let ready;
export const init = () => ready ??= (async () => {
  await sql`CREATE TABLE IF NOT EXISTS categories(slug text PRIMARY KEY,name text NOT NULL,description text DEFAULT '',sort int DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS drops(id serial PRIMARY KEY,title text NOT NULL,description text DEFAULT '',category text REFERENCES categories(slug),url text NOT NULL,thumb text,published boolean DEFAULT true,featured boolean DEFAULT false,created_at timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS events(id bigserial PRIMARY KEY,type text NOT NULL,drop_id int,day date DEFAULT current_date,vid text,created_at timestamptz DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS ev_idx ON events(type,drop_id,day)`;
  await sql`CREATE TABLE IF NOT EXISTS attempts(ip text,at timestamptz DEFAULT now())`;
  await sql`INSERT INTO categories VALUES('steam','STEAM','Steam drops',1),('xbox','XBOX','Xbox drops',2),('cookies','COOKIES','Safe text resources and docs only',3),('other','OTHER','Everything else',4) ON CONFLICT DO NOTHING`;
})();
const mac = b => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(b).digest('base64url');
export const sign = o => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + mac(b); };
export const user = req => {
  const t = (req.headers.cookie || '').match(/rm_s=([^;]+)/)?.[1]; if (!t) return;
  const [b, s] = t.split('.'), e = mac(b || '');
  if (!s || s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return;
  const o = JSON.parse(Buffer.from(b, 'base64url')); return o.exp > Date.now() ? o : undefined;
};
export const ip = r => (r.headers['x-forwarded-for'] || '').split(',')[0].trim() || '0';
export const vid = r => crypto.createHash('sha256').update(ip(r) + r.headers['user-agent'] + new Date().toISOString().slice(0, 10) + process.env.SESSION_SECRET).digest('hex').slice(0, 24);
export const checkPw = (pw, st = '') => {
  const [salt, h] = st.split(':'); if (!salt || !h) return false;
  const a = crypto.scryptSync(pw, salt, 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export const send = (res, c, d) => res.status(c).json(d);
