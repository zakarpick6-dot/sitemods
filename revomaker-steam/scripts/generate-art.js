'use strict';

/**
 * Generates the procedural key-art used across the platform.
 * Every drop gets a unique SVG cover — no stock images, no external requests.
 *
 *   node scripts/generate-art.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DROP_DIR = path.join(ROOT, 'public', 'assets', 'drops');
const CATEGORY_DIR = path.join(ROOT, 'public', 'assets', 'categories');
fs.mkdirSync(DROP_DIR, { recursive: true });
fs.mkdirSync(CATEGORY_DIR, { recursive: true });

const WIDTH = 1200;
const HEIGHT = 750;

const ART = [
  { file: 'chromatic-drift', label: 'CHROMATIC DRIFT', pattern: 'orbit', accent: '#38BDF8', accent2: '#8B5CF6', base: '#081018', code: 'CHR-01' },
  { file: 'steam-replay', label: 'STEAM REPLAY', pattern: 'grid', accent: '#22D3EE', accent2: '#6366F1', base: '#061018', code: 'RPL-02' },
  { file: 'neon-circuit', label: 'NEON CIRCUIT', pattern: 'portal', accent: '#F472B6', accent2: '#8B5CF6', base: '#100612', code: 'NEO-03' },
  { file: 'pixel-forge', label: 'PIXEL FORGE', pattern: 'shards', accent: '#34D399', accent2: '#06B6D4', base: '#04120F', code: 'PXF-04' },
  { file: 'game-pass', label: 'GAME PASS', pattern: 'orbit', accent: '#22C55E', accent2: '#A3E635', base: '#04120A', code: 'XGP-05' },
  { file: 'halo-season', label: 'FIELD GUIDE', pattern: 'rings', accent: '#4ADE80', accent2: '#38BDF8', base: '#06120C', code: 'HAL-06' },
  { file: 'forza-livery', label: 'LIVERY LAB', pattern: 'peaks', accent: '#F59E0B', accent2: '#EF4444', base: '#160B05', code: 'FRZ-07' },
  { file: 'cookie-handbook', label: 'COOKIE HYGIENE', pattern: 'doc', accent: '#F59E0B', accent2: '#FBBF24', base: '#140E03', code: 'CKY-08' },
  { file: 'consent-checklist', label: 'CONSENT UX', pattern: 'doc', accent: '#FBBF24', accent2: '#F97316', base: '#140D04', code: 'CNS-09' },
  { file: 'privacy-analytics', label: 'PRIVACY FIRST', pattern: 'waves', accent: '#FCD34D', accent2: '#F59E0B', base: '#12100A', code: 'PRV-10' },
  { file: 'wallpaper-vault', label: 'WALLPAPER VAULT', pattern: 'waves', accent: '#A855F7', accent2: '#EC4899', base: '#0E0616', code: 'WLP-11' },
  { file: 'bracket-toolkit', label: 'BRACKET LAB', pattern: 'grid', accent: '#8B5CF6', accent2: '#38BDF8', base: '#0A0718', code: 'BRK-12' },
  { file: 'cloud-gaming', label: 'CLOUD PLAY', pattern: 'portal', accent: '#22C55E', accent2: '#0EA5E9', base: '#04120E', code: 'CLD-13' },
  { file: 'fallback-steam', label: 'STEAM DROP', pattern: 'orbit', accent: '#38BDF8', accent2: '#8B5CF6', base: '#081018', code: 'SDR-00' },
  { file: 'fallback-xbox', label: 'XBOX DROP', pattern: 'rings', accent: '#22C55E', accent2: '#A3E635', base: '#04120A', code: 'XDR-00' },
  { file: 'fallback-cookies', label: 'SAFE RESOURCE', pattern: 'doc', accent: '#F59E0B', accent2: '#FBBF24', base: '#140E03', code: 'CDR-00' },
  { file: 'fallback-other', label: 'COMMUNITY DROP', pattern: 'waves', accent: '#A855F7', accent2: '#38BDF8', base: '#0C0716', code: 'ODR-00' },
];

function hashSeed(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function particles(random, accent, count = 26) {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const x = (random() * WIDTH).toFixed(0);
    const y = (random() * HEIGHT * 0.75).toFixed(0);
    const r = (0.6 + random() * 1.8).toFixed(2);
    const opacity = (0.12 + random() * 0.5).toFixed(2);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${accent}" opacity="${opacity}"/>`;
  }
  return out;
}

function gridLines(accent) {
  let out = '';
  const horizon = 470;
  const vanishX = 600;
  for (let i = -12; i <= 12; i += 1) {
    const x = vanishX + i * 150;
    out += `<line x1="${x}" y1="${HEIGHT + 40}" x2="${vanishX + i * 12}" y2="${horizon}" stroke="${accent}" stroke-opacity="0.16" stroke-width="1"/>`;
  }
  let gap = 10;
  let y = horizon;
  for (let i = 0; i < 12; i += 1) {
    y += gap;
    gap *= 1.45;
    if (y > HEIGHT) break;
    out += `<line x1="0" y1="${y.toFixed(0)}" x2="${WIDTH}" y2="${y.toFixed(0)}" stroke="${accent}" stroke-opacity="0.12" stroke-width="1"/>`;
  }
  return out;
}

function diagonalStreaks(accent) {
  return `
    <polygon points="760,0 1010,0 690,750 520,750" fill="url(#streak)" opacity="0.55"/>
    <polygon points="1040,0 1120,0 900,750 840,750" fill="url(#streak)" opacity="0.35"/>
    <path d="M0 618 L1200 388" stroke="${accent}" stroke-opacity="0.18" stroke-width="2"/>
    <path d="M0 668 L1200 438" stroke="${accent}" stroke-opacity="0.08" stroke-width="1"/>`;
}

function orbit(accent, accent2, random) {
  const nodes = Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2 + random() * 0.4;
    const x = 760 + Math.cos(angle) * 190;
    const y = 360 + Math.sin(angle) * 120;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(3 + random() * 3).toFixed(1)}" fill="${accent}" opacity="0.9"/>
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(12 + random() * 8).toFixed(1)}" fill="none" stroke="${accent}" stroke-opacity="0.25"/>`;
  }).join('');
  return `
    <g transform="translate(760 360) rotate(-18)">
      <ellipse rx="330" ry="128" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="1.4"/>
      <ellipse rx="268" ry="102" fill="none" stroke="${accent2}" stroke-opacity="0.42" stroke-width="1"/>
      <ellipse rx="392" ry="156" fill="none" stroke="${accent}" stroke-opacity="0.16" stroke-width="1"/>
    </g>
    ${nodes}
    <circle cx="760" cy="360" r="104" fill="url(#core)" stroke="${accent}" stroke-opacity="0.65" stroke-width="1.6"/>
    <circle cx="760" cy="360" r="138" fill="none" stroke="${accent2}" stroke-opacity="0.28" stroke-dasharray="3 10"/>
    <circle cx="760" cy="360" r="58" fill="none" stroke="${accent}" stroke-opacity="0.5"/>
    <path d="M748 326 L748 394 M766 326 L766 394" stroke="${accent}" stroke-width="4" stroke-linecap="round" opacity="0.9"/>`;
}

function portal(accent, accent2) {
  const layers = [];
  for (let i = 6; i >= 0; i -= 1) {
    const w = 300 - i * 34;
    const h = 420 - i * 48;
    const rotate = -14 + i * 2.4;
    const opacity = (0.1 + (6 - i) * 0.09).toFixed(2);
    layers.push(
      `<rect x="${760 - w / 2}" y="${360 - h / 2}" width="${w}" height="${h}" rx="${40 - i * 4}" fill="none" stroke="${i % 2 ? accent2 : accent}" stroke-opacity="${opacity}" stroke-width="1.6" transform="rotate(${rotate} 760 360)"/>`
    );
  }
  const dots = Array.from({ length: 14 }, () => {
    const x = 560 + Math.random() * 400;
    const y = 180 + Math.random() * 360;
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="1.4" fill="${accent}" opacity="0.6"/>`;
  }).join('');
  return `
    ${layers}
    <rect x="700" y="300" width="120" height="120" rx="30" fill="url(#core)" stroke="${accent}" stroke-opacity="0.6"/>
    <path d="M742 360 H778 M760 342 V378" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity="0.9"/>
    ${dots}`;
}

function shards(accent, accent2, random) {
  const shards = [];
  for (let i = 0; i < 9; i += 1) {
    const cx = 700 + (random() - 0.5) * 360;
    const cy = 340 + (random() - 0.5) * 300;
    const size = 30 + random() * 90;
    const points = [
      [cx, cy - size],
      [cx + size * 0.7, cy + size * 0.2],
      [cx - size * 0.2, cy + size * 0.85],
      [cx - size * 0.75, cy - size * 0.1],
    ];
    shards.push(
      `<polygon points="${points.map((p) => p.map((n) => n.toFixed(0)).join(',')).join(' ')}" fill="${i % 2 ? accent : accent2}" fill-opacity="${(0.05 + random() * 0.2).toFixed(2)}" stroke="${i % 2 ? accent : accent2}" stroke-opacity="0.55" stroke-width="1.3"/>`
    );
  }
  return `
    <g transform="rotate(-8 760 360)">${shards.join('')}</g>
    <path d="M612 540 L760 200 L908 540 Z" fill="none" stroke="${accent}" stroke-opacity="0.28"/>
    <path d="M672 540 L760 330 L848 540 Z" fill="none" stroke="${accent2}" stroke-opacity="0.3"/>`;
}

function waves(accent, accent2, random) {
  const lines = [];
  for (let i = 0; i < 7; i += 1) {
    const y = 250 + i * 44;
    const amp = 40 + random() * 40;
    lines.push(
      `<path d="M420 ${y} C 560 ${y - amp}, 680 ${y + amp}, 820 ${y} S 1080 ${y - amp * 0.7}, 1200 ${y}" fill="none" stroke="${i % 2 ? accent2 : accent}" stroke-opacity="${(0.12 + i * 0.07).toFixed(2)}" stroke-width="${(1 + i * 0.25).toFixed(1)}"/>`
    );
  }
  return `
    ${lines.join('')}
    <circle cx="820" cy="350" r="5" fill="${accent}"/>
    <circle cx="820" cy="350" r="22" fill="none" stroke="${accent}" stroke-opacity="0.4"/>
    <circle cx="820" cy="350" r="52" fill="none" stroke="${accent}" stroke-opacity="0.16"/>`;
}

function rings(accent, accent2) {
  return `
    <g transform="translate(760 350)">
      <circle r="196" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="2"/>
      <circle r="152" fill="none" stroke="${accent2}" stroke-opacity="0.5" stroke-width="1.5"/>
      <circle r="104" fill="url(#core)" stroke="${accent}" stroke-opacity="0.7" stroke-width="1.5"/>
      <path d="M-96 -56 A 112 112 0 0 1 96 56" fill="none" stroke="${accent2}" stroke-opacity="0.85" stroke-width="3" stroke-linecap="round"/>
      <path d="M-70 30 L0 -56 L70 30" fill="none" stroke="${accent}" stroke-opacity="0.85" stroke-width="3" stroke-linejoin="round"/>
      <circle r="236" fill="none" stroke="${accent}" stroke-opacity="0.14" stroke-dasharray="2 12"/>
      <circle cx="196" cy="0" r="4" fill="${accent}"/>
      <circle cx="-196" cy="0" r="4" fill="${accent2}"/>
    </g>`;
}

function peaks(accent, accent2) {
  return `
    <g>
      <path d="M360 570 L620 250 L820 500 L960 330 L1180 620 L360 620 Z" fill="url(#peak)" opacity="0.55" stroke="${accent}" stroke-opacity="0.35"/>
      <path d="M470 570 L700 330 L880 570 Z" fill="${accent}" fill-opacity="0.07" stroke="${accent}" stroke-opacity="0.45"/>
      <path d="M620 250 L686 328 L640 320 L606 340 Z" fill="${accent}" fill-opacity="0.5"/>
      <path d="M960 330 L1004 390 L960 382 L926 398 Z" fill="${accent2}" fill-opacity="0.55"/>
      <path d="M300 620 H1180" stroke="${accent}" stroke-opacity="0.5" stroke-width="2"/>
      <circle cx="960" cy="330" r="70" fill="none" stroke="${accent2}" stroke-opacity="0.2"/>
      <circle cx="960" cy="330" r="104" fill="none" stroke="${accent2}" stroke-opacity="0.1"/>
    </g>`;
}

function doc(accent, accent2) {
  return `
    <g transform="rotate(-6 760 360)">
      <rect x="600" y="176" width="330" height="396" rx="22" fill="#0B0B13" fill-opacity="0.85" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.6"/>
      <path d="M860 176 L930 246 L860 246 Z" fill="${accent}" fill-opacity="0.22" stroke="${accent}" stroke-opacity="0.5"/>
      <rect x="642" y="232" width="150" height="13" rx="6" fill="${accent}" fill-opacity="0.85"/>
      <rect x="642" y="262" width="232" height="7" rx="3.5" fill="#FFFFFF" fill-opacity="0.18"/>
      <rect x="642" y="284" width="204" height="7" rx="3.5" fill="#FFFFFF" fill-opacity="0.12"/>
      <rect x="642" y="306" width="224" height="7" rx="3.5" fill="#FFFFFF" fill-opacity="0.12"/>
      <rect x="642" y="346" width="80" height="7" rx="3.5" fill="${accent2}" fill-opacity="0.7"/>
      <rect x="642" y="368" width="196" height="7" rx="3.5" fill="#FFFFFF" fill-opacity="0.1"/>
      <rect x="642" y="390" width="172" height="7" rx="3.5" fill="#FFFFFF" fill-opacity="0.1"/>
      <circle cx="818" cy="486" r="42" fill="none" stroke="${accent}" stroke-opacity="0.6" stroke-width="1.6"/>
      <circle cx="818" cy="486" r="30" fill="${accent}" fill-opacity="0.1"/>
      <path d="M800 486 L812 498 L838 470" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g opacity="0.5">
      <rect x="960" y="240" width="120" height="86" rx="14" fill="none" stroke="${accent2}" stroke-opacity="0.4" transform="rotate(14 1020 283)"/>
      <circle cx="1020" cy="283" r="4" fill="${accent2}"/>
      <circle cx="1000" cy="264" r="4" fill="${accent2}"/>
    </g>`;
}

const patterns = { orbit, portal, shards, waves, rings, peaks, grid: gridLines, doc };

function svgFor(art, { width = WIDTH, height = HEIGHT, withLabels = true, seedExtra = '' } = {}) {
  const seed = hashSeed(`${art.file}:${seedExtra}`);
  const random = rng(seed);
  const { accent, accent2, base, label, code, pattern } = art;
  const patternMarkup =
    pattern === 'grid'
      ? gridLines(accent)
      : patterns[pattern](accent, accent2, random);
  const monogram = label
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 3);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${art.label} key art">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${base}"/>
      <stop offset="0.55" stop-color="#08080E"/>
      <stop offset="1" stop-color="#050509"/>
    </linearGradient>
    <radialGradient id="glowA" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.6"/>
      <stop offset="0.55" stop-color="${accent}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${accent2}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${accent2}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core" cx="42%" cy="38%" r="70%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${accent2}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#06060B" stop-opacity="0.2"/>
    </radialGradient>
    <linearGradient id="streak" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="peak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${accent2}" stop-opacity="0.02"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.62" stop-color="#000" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.86"/>
    </linearGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${accent}" stop-opacity="0.7"/>
      <stop offset="1" stop-color="${accent2}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1" fill="#FFFFFF" opacity="0.028"/>
    </pattern>
    <filter id="blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="46"/>
    </filter>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.055"/></feComponentTransfer>
    </filter>
    <clipPath id="frame"><rect width="${width}" height="${height}"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <ellipse cx="${width * 0.66}" cy="${height * 0.3}" rx="${width * 0.38}" ry="${height * 0.5}" fill="url(#glowA)" filter="url(#blur)"/>
    <ellipse cx="${width * 0.16}" cy="${height * 0.82}" rx="${width * 0.3}" ry="${height * 0.4}" fill="url(#glowB)" filter="url(#blur)"/>

    ${pattern === 'grid' ? '' : gridLines(accent)}
    ${diagonalStreaks(accent)}

    <g opacity="0.9">${patternMarkup}</g>
    ${particles(random, accent)}

    <rect y="${height * 0.55}" width="${width}" height="${height * 0.45}" fill="url(#fade)"/>

    <g opacity="${withLabels ? 1 : 0}">
      <rect x="38" y="38" width="${width - 76}" height="${height - 76}" rx="18" fill="none" stroke="#FFFFFF" stroke-opacity="0.08"/>
      <circle cx="58" cy="66" r="4" fill="${accent}"/>
      <text x="74" y="71" font-family="'JetBrains Mono',monospace" font-size="13" letter-spacing="3.2" fill="#FFFFFF" fill-opacity="0.58">REVOMAKER // ${label}</text>
      <text x="${width - 56}" y="${height - 54}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="12" letter-spacing="2.6" fill="#FFFFFF" fill-opacity="0.34">${code}</text>
      <text x="${width + 18}" y="${height - 92}" text-anchor="end" font-family="'Space Grotesk','Segoe UI',sans-serif" font-size="300" font-weight="700" letter-spacing="-8" fill="none" stroke="${accent}" stroke-opacity="0.14" stroke-width="1.2">${monogram}</text>
      <rect x="56" y="${height - 62}" width="120" height="2" fill="url(#sweep)"/>
    </g>

    <rect width="${width}" height="${height}" fill="url(#scan)"/>
    <rect width="${width}" height="${height}" filter="url(#grain)" opacity="0.6"/>
  </g>
</svg>
`;
}

let written = 0;
for (const art of ART) {
  fs.writeFileSync(path.join(DROP_DIR, `${art.file}.svg`), svgFor(art));
  written += 1;
}

const CATEGORY_ART = [
  { slug: 'steam', label: 'STEAM', pattern: 'orbit', accent: '#38BDF8', accent2: '#8B5CF6', base: '#071019' },
  { slug: 'xbox', label: 'XBOX', pattern: 'rings', accent: '#22C55E', accent2: '#A3E635', base: '#04120A' },
  { slug: 'cookies', label: 'COOKIES', pattern: 'doc', accent: '#F59E0B', accent2: '#FBBF24', base: '#140E03' },
  { slug: 'other', label: 'OTHER', pattern: 'waves', accent: '#A855F7', accent2: '#38BDF8', base: '#0C0716' },
];

for (const category of CATEGORY_ART) {
  const art = {
    ...category,
    file: `category-${category.slug}`,
    code: 'CATEGORY',
  };
  const svg = svgFor(art, { width: 1600, height: 620, withLabels: false, seedExtra: 'cover' }).replace(
    '</svg>',
    `<g opacity="0.9">
      <text x="64" y="150" font-family="'Space Grotesk','Segoe UI',sans-serif" font-size="132" font-weight="700" letter-spacing="-7" fill="#FFFFFF" fill-opacity="0.08">${category.label}</text>
    </g></svg>`
  );
  fs.writeFileSync(path.join(CATEGORY_DIR, `${category.slug}.svg`), svg);
}

console.log(`  ✓ Generated ${written} drop artworks and ${CATEGORY_ART.length} category covers.`);
