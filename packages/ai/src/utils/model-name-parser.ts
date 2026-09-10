export type ModelTier = 'ultra' | 'max' | 'pro' | 'standard' | 'fast' | 'mini' | 'lite';

export interface ParsedModelName {
  family: string;
  version: [number, number];
  tier: ModelTier;
  tierScore: number;
  dateSuffix: string | null;
}

const TIER_KEYWORDS: Array<{ tier: ModelTier; score: number; keywords: RegExp }> = [
  { tier: 'ultra', score: 6, keywords: /\b(ultra|master|premium)\b/i },
  { tier: 'max', score: 5, keywords: /\b(max|xl)\b/i },
  { tier: 'pro', score: 4, keywords: /\b(pro|plus|hd|enhanced)\b/i },
  { tier: 'standard', score: 3, keywords: /\b(standard|default)\b/i },
  { tier: 'fast', score: 2, keywords: /\b(fast|turbo|speed|quick)\b/i },
  { tier: 'mini', score: 1, keywords: /\b(mini|nano|small)\b/i },
  { tier: 'lite', score: 0, keywords: /\b(lite|light|basic)\b/i },
];

const TIER_SPEED_SCORES: Record<ModelTier, number> = {
  ultra: 0,
  max: 0,
  pro: 0,
  standard: 1,
  fast: 3,
  mini: 3,
  lite: 3,
};

export function parseModelName(modelName: string): ParsedModelName {
  let remaining = modelName.trim();
  let dateSuffix: string | null = null;
  let tier: ModelTier = 'standard';
  let tierScore = 3;
  let version: [number, number] = [1, 0];

  const dateMatch = remaining.match(/-(\d{4}-\d{2}-\d{2})$/);
  if (dateMatch) {
    dateSuffix = dateMatch[1];
    remaining = remaining.slice(0, dateMatch.index);
  }

  for (const { tier: t, score, keywords } of TIER_KEYWORDS) {
    if (keywords.test(remaining)) {
      tier = t;
      tierScore = score;
      remaining = remaining.replace(keywords, '');
      break;
    }
  }

  const versionMatch = remaining.match(/v?(\d+)(?:\.(\d+))?/);
  if (versionMatch) {
    version = [parseInt(versionMatch[1], 10), versionMatch[2] ? parseInt(versionMatch[2], 10) : 0];
    remaining = remaining.replace(versionMatch[0], '');
  }

  const family =
    remaining
      .replace(/^[-\s]+|[-\s]+$/g, '')
      .replace(/[-\s]+/g, '-')
      .toLowerCase() || modelName.toLowerCase();

  return { family, version, tier, tierScore, dateSuffix };
}

export function getQualityScore(parsed: ParsedModelName): number {
  const versionScore = parsed.version[0] * 10 + parsed.version[1];
  return versionScore * 10 + parsed.tierScore;
}

export function getSpeedScore(parsed: ParsedModelName): number {
  return TIER_SPEED_SCORES[parsed.tier];
}
