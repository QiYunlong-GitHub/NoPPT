const PLACEHOLDER_SRC_RE =
  /(<img\b[^>]*?src\s*=\s*["'])\s*`?https:\/\/NOPPT_IMAGE_PLACEHOLDER`?\s*(["'][^>]*>)/gi;

function buildGrayPlaceholderDataUri(): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>` +
    `<rect width='100%' height='100%' fill='#e5e7eb'/>` +
    `<g fill='#9ca3af'>` +
    `<rect x='340' y='250' width='120' height='90' rx='10' fill='#d1d5db'/>` +
    `<circle cx='375' cy='285' r='14' fill='#9ca3af'/>` +
    `<polygon points='360,330 395,295 430,330' fill='#9ca3af'/>` +
    `<text x='400' y='395' text-anchor='middle' font-family='sans-serif' font-size='26' fill='#9ca3af'>图片占位</text>` +
    `</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

let cachedDataUri: string | null = null;

export function renderPlaceholdersAsGrayBlock(html: string): string {
  if (!html || !html.includes('NOPPT_IMAGE_PLACEHOLDER')) return html;
  if (!cachedDataUri) cachedDataUri = buildGrayPlaceholderDataUri();
  return html.replace(PLACEHOLDER_SRC_RE, `$1${cachedDataUri}$2`);
}
