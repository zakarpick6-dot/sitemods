import { sql, init, sign, user, ip, checkPw, send } from './_lib.js';
export default async function h(req, res) {
  try {
    await init();
    if (req.method === 'GET') return send(res, 200, { user: user(req)?.u || null });
    if (req.headers['x-rm'] !== '1') return send(res, 403, { error: 'Forbidden' });
    const ck = v => `rm_s=${v}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${v ? 604800 : 0}`;
    if (req.method === 'DELETE') { res.setHeader('Set-Cookie', ck('')); return send(res, 200, { ok: 1 }); }
    const [{ n }] = await sql`SELECT count(*)::int n FROM attempts WHERE ip=${ip(req)} AND at>now()-interval '15 minutes'`;
    if (n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const { u = '', p = '' } = req.body || {};
    const owners = [[process.env.OWNER1_USER, process.env.OWNER1_HASH], [process.env.OWNER2_USER, process.env.OWNER2_HASH]];
    const ok = owners.some(([n2, hh]) => n2 && n2 === u && checkPw(String(p), hh));
    if (!ok) { await sql`INSERT INTO attempts(ip) VALUES(${ip(req)})`; return send(res, 401, { error: 'Wrong username or password' }); }
    res.setHeader('Set-Cookie', ck(sign({ u, exp: Date.now() + 604800000 })));
    send(res, 200, { user: u });
  } catch (e) { console.error(e); send(res, 500, { error: 'Server error' }); }
}
