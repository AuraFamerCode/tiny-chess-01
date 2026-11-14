// Builds the news-image-01 poster: one 1024x1024 editorial grid of 13 Nov 2026's world news.
import { mkdirSync, writeFileSync } from 'node:fs';

const PAPER = '#F4EEE2';
const INK = '#14110D';
const MUTED = '#6B6154';
const RED = '#A8322A';
const BLUE = '#1B3A57';
const GOLD = '#B98A2F';

const W = 1024;
const M = 40;          // outer margin
const GAP = 14;
const CELL = (W - 2 * M - 2 * GAP) / 3; // 304
const x = (c) => M + c * (CELL + GAP);
const y = (r) => M + r * (CELL + GAP);

// Each icon draws inside a 100x100 box.
const icons = {
  handshake: `
    <path d="M2 45 L28 39 L28 61 L2 55 Z" fill="${BLUE}"/>
    <path d="M98 43 L72 37 L72 59 L98 53 Z" fill="${RED}"/>
    <rect x="24" y="41" width="30" height="18" rx="9" fill="${INK}"/>
    <rect x="46" y="45" width="30" height="18" rx="9" fill="${INK}"/>
    <path d="M38 42 L46 32 L55 32 L50 43 Z" fill="${INK}"/>
    <path d="M24 50 H34 M66 54 H76" stroke="${PAPER}" stroke-width="3" stroke-linecap="round"/>`,
  plane: `
    <g transform="translate(50 50) rotate(38)">
      <path d="M0 -34 C4 -34 6 -26 6 -14 L6 4 L26 16 L26 22 L6 16 L6 26 L14 32 L14 36 L0 33 L-14 36 L-14 32 L-6 26 L-6 16 L-26 22 L-26 16 L-6 4 L-6 -14 C-6 -26 -4 -34 0 -34 Z" fill="${INK}"/>
    </g>
    <rect x="6" y="43" width="88" height="14" rx="7" fill="${RED}"/>`,
  drone: `
    <g stroke="${INK}" stroke-width="6" stroke-linecap="round" fill="none">
      <path d="M30 70 L70 30"/><path d="M30 30 L70 70"/>
      <circle cx="30" cy="30" r="11" fill="${PAPER}"/>
      <circle cx="70" cy="30" r="11" fill="${PAPER}"/>
      <circle cx="30" cy="70" r="11" fill="${PAPER}"/>
      <circle cx="70" cy="70" r="11" fill="${PAPER}"/>
      <path d="M22 30 H38 M30 22 V38 M62 30 H78 M70 22 V38 M22 70 H38 M30 62 V78 M62 70 H78 M70 62 V78" stroke-width="3.4"/>
    </g>
    <circle cx="50" cy="50" r="14" fill="${RED}"/>
    <path d="M92 22 A22 22 0 0 1 92 44" stroke="${INK}" stroke-width="4" fill="none" opacity="0.45"/>
    <path d="M99 14 A32 32 0 0 1 99 52" stroke="${INK}" stroke-width="4" fill="none" opacity="0.25"/>`,
  chip: `
    <g stroke="${INK}" stroke-width="4.5" stroke-linecap="round">
      <rect x="8" y="30" width="46" height="46" rx="5" fill="none"/>
      <rect x="22" y="44" width="18" height="18" rx="3" fill="${INK}" stroke="none"/>
      <path d="M18 30 V18 M31 30 V18 M44 30 V18 M18 76 V88 M31 76 V88 M44 76 V88"/>
      <path d="M8 40 H-2 M8 53 H-2 M8 66 H-2"/>
    </g>
    <path d="M80 20 L80 66 M70 56 L80 68 L90 56" stroke="${RED}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  flags: `
    <g stroke="${INK}" stroke-width="4" stroke-linecap="round">
      <path d="M16 24 V86 M50 18 V86 M84 24 V86"/>
      <path d="M8 88 H92" stroke-width="3" opacity="0.4"/>
    </g>
    <g>
      <rect x="16" y="26" width="26" height="17" fill="#ffffff" stroke="${INK}" stroke-width="2"/>
      <rect x="16" y="31.6" width="26" height="3.4" fill="#B22234" stroke="none"/>
      <rect x="16" y="38.6" width="26" height="3.4" fill="#B22234" stroke="none"/>
      <rect x="16" y="26" width="11" height="9" fill="#1B3A57" stroke="none"/>
    </g>
    <g>
      <rect x="50" y="20" width="26" height="17" fill="#DE2910" stroke="${INK}" stroke-width="2"/>
      <path d="M56 23 l1.4 4.2 4.4 0 -3.5 2.6 1.3 4.2 -3.5-2.6 -3.5 2.6 1.3-4.2 -3.5-2.6 4.4 0 Z" fill="#FFDE00" stroke="none"/>
    </g>
    <g>
      <rect x="84" y="26" width="26" height="17" fill="#ffffff" stroke="${INK}" stroke-width="2"/>
      <rect x="84" y="26" width="26" height="5.7" fill="#ffffff" stroke="none"/>
      <rect x="84" y="31.7" width="26" height="5.7" fill="#0039A6" stroke="none"/>
      <rect x="84" y="37.4" width="26" height="5.6" fill="#D52B1E" stroke="none"/>
      <rect x="84" y="26" width="26" height="17" fill="none" stroke="${INK}" stroke-width="2"/>
    </g>`,
  globe: `
    <g stroke="${BLUE}" stroke-width="5" fill="none">
      <circle cx="34" cy="52" r="30"/>
      <ellipse cx="34" cy="52" rx="13" ry="30"/>
      <path d="M5 42 H63 M5 62 H63"/>
    </g>
    <g stroke="${GOLD}" stroke-width="4" fill="none">
      <circle cx="80" cy="80" r="14" fill="${PAPER}"/>
      <path d="M74 80 H86 M80 74 V86"/>
    </g>
    <path d="M82 16 L82 44 M73 36 L82 47 L91 36" stroke="${RED}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  smog: `
    <g fill="${INK}">
      <rect x="10" y="52" width="18" height="42" rx="2"/>
      <rect x="34" y="36" width="20" height="58" rx="2"/>
      <rect x="60" y="46" width="16" height="48" rx="2"/>
      <rect x="82" y="26" width="10" height="68" rx="2"/>
    </g>
    <g fill="${PAPER}" opacity="0.55">
      <rect x="14" y="58" width="4" height="5"/><rect x="21" y="58" width="4" height="5"/>
      <rect x="14" y="68" width="4" height="5"/><rect x="21" y="68" width="4" height="5"/>
      <rect x="38" y="44" width="4" height="5"/><rect x="46" y="44" width="4" height="5"/>
      <rect x="38" y="54" width="4" height="5"/><rect x="46" y="54" width="4" height="5"/>
      <rect x="64" y="54" width="4" height="5"/><rect x="64" y="64" width="4" height="5"/>
    </g>
    <circle cx="79" cy="20" r="12" fill="${GOLD}" opacity="0.8"/>
    <g stroke="${MUTED}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.9">
      <path d="M4 34 C22 26 34 42 52 34 C70 26 82 42 100 34"/>
      <path d="M4 88 C22 80 34 96 52 88 C70 80 82 96 100 88"/>
    </g>`,
  bowl: `
    <g stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round">
      <path d="M14 48 H86 C86 72 68 84 50 84 C32 84 14 72 14 48 Z" fill="${PAPER}"/>
      <path d="M50 84 V90"/>
      <path d="M30 96 H70" stroke-width="4"/>
    </g>
    <path d="M34 40 C34 30 44 30 44 20 M52 40 C52 28 62 30 62 18 M70 40 C70 32 76 32 76 24" stroke="${RED}" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/>`,
};

const stories = [
  {
    kicker: 'EUROPE',
    icon: 'handshake',
    headline: ['EU JOINS', 'UKRAINE TALKS'],
    fact: 'US envoys met Putin; Europe added to the table; largest POW swap planned',
  },
  {
    kicker: 'UNITED STATES',
    icon: 'plane',
    headline: ['ALL US FLIGHTS', 'GROUNDED'],
    fact: 'FAA halts departures 4 hours: 10,000+ flights hit, overloaded routers',
  },
  {
    kicker: 'MIDDLE EAST',
    icon: 'drone',
    headline: ['US DOWNS', 'IRANIAN DRONES'],
    fact: 'Two shot down near Bahrain; Iran bars UN nuclear inspections',
  },
  {
    kicker: 'MARKETS',
    icon: 'chip',
    headline: ['NVIDIA SLIDES', 'AS HUANG EXITS'],
    fact: 'Chip and AI stocks fall again as the trade wobbles',
  },
  {
    kicker: 'ASIA',
    icon: 'flags',
    headline: ['TRUMP, XI,', 'PUTIN TO MEET'],
    fact: 'An unprecedented summit at APEC in Shenzhen next week',
  },
  {
    kicker: 'CLIMATE',
    icon: 'globe',
    headline: ['COP31:', 'CASH GAP'],
    fact: 'Guterres: tripling adaptation aid still meets under a third of need',
  },
  {
    kicker: 'SOUTH ASIA',
    icon: 'smog',
    headline: ['DELHI: WORLD\u2019S', 'WORST AIR'],
    fact: 'Overtakes Lahore; hazardous smog over a city of 20 million',
  },
  {
    kicker: 'AFRICA',
    icon: 'bowl',
    headline: ['DR CONGO:', '30M FACE HUNGER'],
    fact: 'UN projects a record by 2027; Ebola funds miss the front line',
  },
];

function titleCell() {
  return `
  <g transform="translate(${x(0)} ${y(0)})">
    <rect width="${CELL}" height="${CELL}" fill="${INK}"/>
    <text x="22" y="52" font-family="Helvetica Neue, Helvetica, Arial" font-size="13" letter-spacing="3.4" fill="${RED}" font-weight="700">FRIDAY</text>
    <text x="22" y="126" font-family="Georgia, Times New Roman, serif" font-size="58" font-weight="700" fill="${PAPER}">13 NOV</text>
    <text x="22" y="186" font-family="Georgia, Times New Roman, serif" font-size="58" font-weight="700" fill="${PAPER}">2026</text>
    <rect x="22" y="206" width="60" height="4" fill="${RED}"/>
    <text x="22" y="240" font-family="Helvetica Neue, Helvetica, Arial" font-size="17" letter-spacing="2.2" fill="${PAPER}">WORLD NEWS</text>
    <text x="22" y="264" font-family="Helvetica Neue, Helvetica, Arial" font-size="17" letter-spacing="2.2" fill="${PAPER}">IN ONE IMAGE</text>
    <text x="22" y="292" font-family="Helvetica Neue, Helvetica, Arial" font-size="10.5" fill="#9A9184">The day, in eight stories</text>
  </g>`;
}

function wrap(text, budget) {
  const out = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && (cur + ' ' + w).length > budget) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return out;
}

function storyCell(s, i) {
  const col = (i + 1) % 3;
  const row = Math.floor((i + 1) / 3);
  const head = wrap(s.headline.join(' '), 16);
  const size = head.length > 2 ? 23 : 27;
  const lead = size === 27 ? 30 : 26;
  const factSize = 12.5;
  const facts = wrap(s.fact, 41);
  const factTop = 196 + head.length * lead + 8;
  return `
  <g transform="translate(${x(col)} ${y(row)})">
    <rect width="${CELL}" height="${CELL}" fill="#FBF7EF"/>
    <rect x="0" y="0" width="${CELL}" height="3" fill="${RED}" opacity="0.85"/>
    <text x="20" y="38" font-family="Helvetica Neue, Helvetica, Arial" font-size="12" letter-spacing="2.6" fill="${RED}" font-weight="700">${s.kicker}</text>
    <g transform="translate(${(CELL - 118) / 2} 54) scale(1.18)">${icons[s.icon]}</g>
    ${head.map((l, k) => `<text x="20" y="${196 + k * lead}" font-family="Georgia, Times New Roman, serif" font-size="${size}" font-weight="700" fill="${INK}">${l}</text>`).join('')}
    ${facts.map((l, k) => `<text x="20" y="${factTop + k * 16}" font-family="Helvetica Neue, Helvetica, Arial" font-size="${factSize}" fill="${MUTED}">${l}</text>`).join('')}
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
  <rect width="${W}" height="${W}" fill="${PAPER}"/>
  ${titleCell()}
  ${stories.map(storyCell).join('')}
</svg>`;

mkdirSync(new URL('.', import.meta.url).pathname, { recursive: true });
writeFileSync(new URL('./poster.html', import.meta.url), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${W}px;height:${W}px;overflow:hidden;background:${PAPER}}</style></head><body>${svg}</body></html>`);
writeFileSync(new URL('./poster.svg', import.meta.url), svg);
console.log('wrote poster.html and poster.svg');
