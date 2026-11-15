import { sql, init } from './_lib.js';
export default async function h(req, res) {
  try {
    await init();
    const [r] = await sql`SELECT thumb FROM drops WHERE id=${+req.query.id || 0} AND thumb IS NOT NULL`;
    if (!r) return res.status(404).end();
    const m = r.thumb.match(/^data:(image\/\w+);base64,(.+)$/);
    res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(m[2], 'base64'));
  } catch (e) { res.status(500).end(); }
}
