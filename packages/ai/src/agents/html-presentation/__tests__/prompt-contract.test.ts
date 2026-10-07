import { describe, expect, it } from 'vitest';
import { buildPlanningPrompt } from '../prompts';

const promptArgs = [
  '气候变化',
  'business',
  '管理层',
  { exact: 5 },
  'normal',
  'content-only',
] as const;

describe('typed planning prompt contract', () => {
  it('requires typed compare, metric, card, and summary content', () => {
    const prompt = buildPlanningPrompt(...promptArgs);

    expect(prompt).toContain('comparisonItems');
    expect(prompt).toContain('metricItems');
    expect(prompt).toContain('cardItems');
    expect(prompt).toContain('summaryItems');
    expect(prompt).toContain('contentId');
    expect(prompt).toContain('不得使用空字符串');
    expect(prompt).toContain('omitted');
  });
});
