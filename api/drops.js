import { sql, init, vid, send } from './_lib.js';
export default async function h(req, res) {
  try {
    await init();
    if (req.method === 'POST') {
      const { t, id } = req.body || {}, v = vid(req);
      if (t === 'visit') await sql`INSERT INTO events(type,vid) SELECT 'visit',${v} WHERE NOT EXISTS(SELECT 1 FROM events WHERE type='visit' AND vid=${v} AND day=current_date)`;
      else if (t === 'view' || t === 'click') await sql`INSERT INTO events(type,drop_id,vid) SELECT ${t},id,${v} FROM drops WHERE id=${+id || 0} AND published`;
      return send(res, 200, { ok: 1 });
    }
    const { cat = '', sort = 'latest' } = req.query, q = String(req.query.q || '').slice(0, 60).replace(/[%_\\]/g, '\\$&');
    const [drops, cats, [stats]] = await Promise.all([
      sql`SELECT d.id,d.title,d.description,d.category,d.url,d.featured,d.created_at,(d.thumb IS NOT NULL) has_thumb,left(md5(d.thumb),8) tv,coalesce(v.n,0)::int views
          FROM drops d LEFT JOIN (SELECT drop_id,count(*) n FROM events WHERE type='view' GROUP BY 1) v ON v.drop_id=d.id
          WHERE d.published AND (${cat}='' OR d.category=${cat}) AND (${q}='' OR d.title ILIKE '%'||${q}||'%' OR d.description ILIKE '%'||${q}||'%')
          ORDER BY CASE WHEN ${sort}='popular' THEN coalesce(v.n,0) END DESC NULLS LAST, CASE WHEN ${sort}='featured' THEN d.featured::int END DESC NULLS LAST, d.created_at DESC LIMIT 60`,
      sql`SELECT slug,name,description FROM categories ORDER BY sort`,
      sql`SELECT (SELECT count(*) FROM drops WHERE published)::int drops,count(*) FILTER(WHERE type='view')::int views,count(*) FILTER(WHERE type='click')::int clicks,count(DISTINCT vid)::int visitors FROM events`
    ]);
    res.setHeader('Cache-Control', 'no-store');
    send(res, 200, { drops, cats, stats });
  } catch (e) { console.error(e); send(res, 500, { error: 'Server error' }); }
}
