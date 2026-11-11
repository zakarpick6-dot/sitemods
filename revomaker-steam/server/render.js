'use strict';

const config = require('./config');
const { all } = require('./db');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value, length = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trimEnd()}…`;
}

function absoluteUrl(pathname = '/') {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${config.APP_URL}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

function jsonLdScript(data, nonce) {
  const safe = JSON.stringify(data).replace(/</g, '\\u003c');
  const attr = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
  return `<script type="application/ld+json"${attr}>${safe}</script>`;
}

function metaBlock({
  title,
  description,
  canonical = '/',
  image = '/assets/brand/og-cover.png',
  type = 'website',
  robots = 'index, follow',
  jsonLd = null,
  nonce = null,
}) {
  const fullTitle = title.includes('REVOMAKER') ? title : `${title} — REVOMAKER STEAM`;
  const desc = truncate(description, 165);
  const imageUrl = absoluteUrl(image);
  const canonicalUrl = absoluteUrl(canonical);
  return [
    `<title>${escapeHtml(fullTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:site_name" content="REVOMAKER STEAM" />`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:type" content="${escapeHtml(type)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    jsonLd ? jsonLdScript(jsonLd, nonce) : '',
  ]
    .filter(Boolean)
    .join('\n    ');
}

function injectHead(html, block) {
  if (!html.includes('<!--HEAD-->')) return html;
  return html.replace('<!--HEAD-->', block);
}

function sitemapXml() {
  const categories = all('SELECT slug, updated_at FROM categories ORDER BY sort_order');
  const drops = all(
    "SELECT slug, updated_at FROM drops WHERE status = 'published' ORDER BY published_at DESC"
  );
  const urls = [
    { loc: absoluteUrl('/'), lastmod: new Date().toISOString(), priority: '1.0' },
    ...categories.map((c) => ({
      loc: absoluteUrl(`/category/${c.slug}`),
      lastmod: c.updated_at,
      priority: '0.8',
    })),
    ...drops.map((d) => ({
      loc: absoluteUrl(`/drop/${d.slug}`),
      lastmod: d.updated_at,
      priority: '0.7',
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${escapeHtml(u.loc)}</loc>\n    <lastmod>${escapeHtml(
          String(u.lastmod || new Date().toISOString()).slice(0, 10)
        )}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /go/',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}

module.exports = {
  escapeHtml,
  truncate,
  absoluteUrl,
  metaBlock,
  injectHead,
  sitemapXml,
  robotsTxt,
  jsonLdScript,
};
