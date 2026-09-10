import type { AuditIssue } from '../../types';
import { extractPlainText, countChineseChars, countEnglishWords } from './html-text-utils';

export interface ContentDensityConfig {
  maxCharsPerSlide?: number;
  minBulletPointsPerCard?: number;
  maxBulletPointsPerCard?: number;
}

const DEFAULT_CONFIG: Required<ContentDensityConfig> = {
  maxCharsPerSlide: 800,
  minBulletPointsPerCard: 2,
  maxBulletPointsPerCard: 3,
};

function isCardDiv(style: string): boolean {
  const lower = style.toLowerCase();
  return (
    lower.includes('border-radius') ||
    lower.includes('background') ||
    lower.includes('border:') ||
    lower.includes('border-width')
  );
}

function extractDivStyle(openTag: string): string {
  const styleMatch = openTag.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i);
  return styleMatch ? styleMatch[2] || styleMatch[3] || '' : '';
}

function extractCardBlocks(html: string): string[] {
  const cards: string[] = [];
  const openRegex = /<div\b([^>]*)>/gi;
  const closeRegex = /<\/div>/gi;

  interface Token {
    type: 'open' | 'close';
    index: number;
    style: string;
    length: number;
  }
  const tokens: Token[] = [];

  let m: RegExpExecArray | null;
  while ((m = openRegex.exec(html)) !== null) {
    tokens.push({
      type: 'open',
      index: m.index,
      style: extractDivStyle(m[1] || ''),
      length: m[0].length,
    });
  }
  while ((m = closeRegex.exec(html)) !== null) {
    tokens.push({ type: 'close', index: m.index, style: '', length: m[0].length });
  }

  tokens.sort((a, b) => a.index - b.index);

  const stack: Array<{ index: number; isCard: boolean }> = [];
  for (const token of tokens) {
    if (token.type === 'open') {
      stack.push({ index: token.index, isCard: token.style.length > 0 && isCardDiv(token.style) });
    } else {
      const top = stack.pop();
      if (top && top.isCard) {
        cards.push(html.substring(top.index, token.index + token.length));
      }
    }
  }

  return cards;
}

function countListItems(cardHtml: string): number {
  const ulMatches = cardHtml.match(/<ul\b[\s\S]*?<\/ul>/gi) || [];
  const olMatches = cardHtml.match(/<ol\b[\s\S]*?<\/ol>/gi) || [];
  let count = 0;
  for (const list of [...ulMatches, ...olMatches]) {
    const liMatches = list.match(/<li\b/gi);
    if (liMatches) count += liMatches.length;
  }
  return count;
}

function isCardEmpty(cardHtml: string): boolean {
  const text = extractPlainText(cardHtml);
  return text.length === 0;
}

export function checkContentDensity(
  html: string,
  slideIndex: number,
  config: ContentDensityConfig = {},
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const plainText = extractPlainText(html);
  const charCount = countChineseChars(plainText) + countEnglishWords(plainText);

  if (charCount > cfg.maxCharsPerSlide) {
    issues.push({
      ruleId: 'content-too-dense',
      severity: 'warn',
      engine: 'content',
      slideIndex,
      message: `第 ${slideIndex + 1} 页内容密度过高（约 ${charCount} 字符/词，上限 ${cfg.maxCharsPerSlide}），可能导致信息过载`,
      fixSuggestion: '精简文字内容，将部分信息拆分到其他页面，使用图表替代文字描述',
      fixable: false,
      metadata: { charCount, maxChars: cfg.maxCharsPerSlide },
    });
  }

  const cards = extractCardBlocks(html);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    if (isCardEmpty(card)) {
      issues.push({
        ruleId: 'empty-card',
        severity: 'warn',
        engine: 'content',
        slideIndex,
        message: `第 ${slideIndex + 1} 页存在空卡片（第 ${i + 1} 个卡片无文本内容）`,
        fixSuggestion: '为空卡片补充内容，或移除无意义的空卡片',
        fixable: false,
        metadata: { cardIndex: i },
      });
      continue;
    }

    const liCount = countListItems(card);
    if (
      liCount > 0 &&
      (liCount < cfg.minBulletPointsPerCard || liCount > cfg.maxBulletPointsPerCard)
    ) {
      issues.push({
        ruleId: 'card-bullet-count',
        severity: 'info',
        engine: 'content',
        slideIndex,
        message: `第 ${slideIndex + 1} 页第 ${i + 1} 个卡片包含 ${liCount} 个列表项（建议 ${cfg.minBulletPointsPerCard}-${cfg.maxBulletPointsPerCard} 个）`,
        fixSuggestion:
          liCount < cfg.minBulletPointsPerCard
            ? '补充更多要点，或合并到其他卡片中'
            : '精简列表项，将多余内容拆分到其他卡片或页面',
        fixable: false,
        metadata: { cardIndex: i, bulletCount: liCount },
      });
    }
  }

  return issues;
}
