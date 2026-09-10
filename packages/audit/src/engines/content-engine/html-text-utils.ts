const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201c',
  '&rdquo;': '\u201d',
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'as', 'not', 'no', 'nor', 'so', 'if',
  'then', 'than', 'too', 'very', 'just', 'about', 'above', 'after',
  'again', 'all', 'also', 'am', 'any', 'because', 'before', 'between',
  'both', 'each', 'few', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'into', 'me', 'more', 'most', 'my',
  'myself', 'now', 'only', 'other', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'she', 'some', 'such', 'their', 'theirs',
  'them', 'themselves', 'there', 'they', 'through', 'under', 'until',
  'up', 'we', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'you', 'your', 'yours', 'yourself', 'yourselves',
]);

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&[#a-zA-Z0-9]+;/g, (entity) => {
    if (HTML_ENTITY_MAP[entity]) return HTML_ENTITY_MAP[entity];
    const hexMatch = entity.match(/^&#x([0-9a-fA-F]+);$/);
    if (hexMatch) {
      const code = parseInt(hexMatch[1], 16);
      if (!Number.isNaN(code)) return String.fromCodePoint(code);
    }
    const numMatch = entity.match(/^&#(\d+);$/);
    if (numMatch) {
      const code = parseInt(numMatch[1], 10);
      if (!Number.isNaN(code)) return String.fromCodePoint(code);
    }
    return entity;
  });
}

export function extractPlainText(html: string): string {
  if (!html) return '';
  const withoutTags = html.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

export function countChineseChars(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  return matches ? matches.length : 0;
}

export function countEnglishWords(text: string): number {
  const matches = text.match(/[a-zA-Z]+(?:['-][a-zA-Z]+)*/g);
  return matches ? matches.length : 0;
}

export function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();

  const chineseSegments = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || [];
  for (const segment of chineseSegments) {
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= segment.length; i++) {
        const word = segment.substring(i, i + len);
        const lower = word.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          keywords.push(word);
        }
      }
    }
  }

  const englishWords = text.match(/[a-zA-Z]+(?:['-][a-zA-Z]+)*/g) || [];
  for (const word of englishWords) {
    const lower = word.toLowerCase();
    if (lower.length > 3 && !STOP_WORDS.has(lower) && !seen.has(lower)) {
      seen.add(lower);
      keywords.push(lower);
    }
  }

  return keywords;
}
