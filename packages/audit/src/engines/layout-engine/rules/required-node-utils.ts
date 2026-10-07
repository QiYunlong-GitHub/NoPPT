export interface HtmlElementMatch {
  attrs: string;
  body: string;
  start: number;
}

export function parseStyle(attrs: string): Record<string, string> {
  const match = attrs.match(/\bstyle\s*=\s*["']([^"']*)["']/iu);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator < 0) return ['', ''];
        return [declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim()];
      })
      .filter(([key]) => Boolean(key)),
  );
}

export function isRequiredContent(attrs: string): boolean {
  const role = attrs.match(/\bdata-role\s*=\s*["']([^"']*)["']/iu)?.[1]?.toLowerCase();
  const decoration = /\bdata-decoration\s*=\s*["']true["']/iu.test(attrs) || role === 'decoration';
  if (decoration) return false;
  return /\bdata-required\s*=\s*["']true["']/iu.test(attrs) || Boolean(attrs.match(/\bdata-content-id\s*=/iu));
}

export function elementMatches(html: string): HtmlElementMatch[] {
  const result: HtmlElementMatch[] = [];
  const pattern = /<(?<tag>div|section|article|p|h1|h2|h3|span)\b(?<attrs>[^>]*)>/giu;
  for (const match of html.matchAll(pattern)) {
    const tag = match.groups?.tag ?? 'div';
    const end = (match.index ?? 0) + match[0].length;
    const closing = html.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, end);
    result.push({ attrs: match.groups?.attrs ?? '', body: closing >= 0 ? html.slice(end, closing) : '', start: match.index ?? 0 });
  }
  return result;
}

export function plainText(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/giu, ' ').replace(/\s+/gu, ' ').trim();
}

export function numberStyle(style: Record<string, string>, key: string): number | undefined {
  const value = style[key];
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
