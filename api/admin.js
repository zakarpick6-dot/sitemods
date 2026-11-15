import { sql, init, user, send } from './_lib.js';
const bad = /(session[\s_-]?token|auth(entication)?[\s_-]?cookie|login[\s_-]?credential|password|\.ROBLOSECURITY|combo ?list)/i;
function clean(b) {
  const o = { title: String(b.title || '').trim(), description: String(b.description || '').trim(), category: String(b.category || ''), url: String(b.url || '').trim(), published: !!b.published, featured: !!b.featured };
  if (!o.title || o.title.length > 80) throw 'Title must be 1-80 characters';
  if (o.description.length > 500) throw 'Description max 500 characters';
  let u; try { u = new URL(o.url); } catch { throw 'Invalid URL'; }
  if (!/^https?:$/.test(u.protocol)) throw 'URL must start with http(s)';
  if (bad.test(o.title + ' ' + o.description)) throw 'Credentials, tokens and auth cookies are not allowed';
  const t = b.thumb;
  if (t && (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(t) || t.length > 400000)) throw 'Invalid thumbnail';
  o.thumb = t || null; o.keep = t === undefined; return o;
}
export default async function h(req, res) {
  try {
    await init();
    if (!user(req)) return send(res, 401, { error: 'Unauthorized' });
    if (req.method !== 'GET' && req.headers['x-rm'] !== '1') return send(res, 403, { error: 'Forbidden' });
    const id = +req.query.id || 0;
    if (req.method === 'DELETE') { await sql`DELETE FROM drops WHERE id=${id}`; await sql`DELETE FROM events WHERE drop_id=${id}`; return send(res, 200, { ok: 1 }); }
    if (req.method === 'POST' || req.method === 'PUT') {
      const o = clean(req.body || {});
      const [c] = await sql`SELECT 1 x FROM categories WHERE slug=${o.category}`; if (!c) throw 'Unknown category';
      if (req.method === 'POST') await sql`INSERT INTO drops(title,description,category,url,thumb,published,featured) VALUES(${o.title},${o.description},${o.category},${o.url},${o.thumb},${o.published},${o.featured})`;
      else await sql`UPDATE drops SET title=${o.title},description=${o.description},category=${o.category},url=${o.url},published=${o.published},featured=${o.featured},thumb=CASE WHEN ${o.keep} THEN thumb ELSE ${o.thumb} END WHERE id=${id}`;
      return send(res, 200, { ok: 1 });
    }
    const [drops, [totals], daily, cats] = await Promise.all([
      sql`SELECT d.id,d.title,d.description,d.category,d.url,d.published,d.featured,d.created_at,(d.thumb IS NOT NULL) has_thumb,left(md5(d.thumb),8) tv,
          count(e.*) FILTER(WHERE e.type='view')::int views,count(e.*) FILTER(WHERE e.type='click')::int clicks
          FROM drops d LEFT JOIN events e ON e.drop_id=d.id GROUP BY d.id ORDER BY d.created_at DESC`,
      sql`SELECT count(*) FILTER(WHERE type='view')::int views,count(*) FILTER(WHERE type='click')::int clicks,count(DISTINCT vid)::int visitors FROM events`,
      sql`SELECT to_char(g,'MM-DD') day,count(e.*) FILTER(WHERE e.type='view')::int views,count(e.*) FILTER(WHERE e.type='click')::int clicks,count(DISTINCT e.vid)::int visitors
          FROM generate_series(current_date-13,current_date,'1 day') g LEFT JOIN events e ON e.day=g GROUP BY g ORDER BY g`,
      sql`SELECT slug,name FROM categories ORDER BY sort`
    ]);
    send(res, 200, { drops, totals, daily, cats });
  } catch (e) { typeof e === 'string' ? send(res, 400, { error: e }) : (console.error(e), send(res, 500, { error: 'Server error' })); }
}
