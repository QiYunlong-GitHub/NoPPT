import { describe, expect, it } from 'vitest';
import type { PresentationPlan } from '../../../../types';
import { buildValidatedDeck } from '../plan-to-deck';

const planWithSparseContentPage = (): PresentationPlan => ({
  title: '稀疏页增强集成',
  primaryColor: '#EA580C',
  slides: [
    {
      pageType: 'content-no-image',
      title: '稀疏内容页',
      // 单要点 + 真实指标 → spacious 且走 kpi 增强分支
      keyPoints: ['海温：赤道中东太平洋持续偏暖'],
      needsImage: false,
      metricItems: [
        {
          kind: 'metric',
          contentId: 'm1',
          order: 0,
          label: '海温距平',
          value: '+0.8℃',
        },
      ],
    },
  ],
});

describe('sparse-enhancement · 生成开关集成', () => {
  it('未开启时 Deck 不含增强装饰（向后兼容）', () => {
    const result = buildValidatedDeck(planWithSparseContentPage(), { validationMode: 'legacy' });
    const deck = result.deck!;
    expect(deck.slides[0].nodes.some((n) => String(n.id ?? '').includes('-enh-'))).toBe(false);
  });

  it('开启后 Deck 节点树含真实语义装饰，且 layoutParams 记录决策', () => {
    const result = buildValidatedDeck(planWithSparseContentPage(), {
      validationMode: 'legacy',
      sparseEnhancement: true,
    });
    const deck = result.deck!;
    const enhanced = deck.slides[0].nodes.filter((n) => String(n.id ?? '').includes('-enh-'));
    expect(enhanced.length).toBeGreaterThan(0);
    expect(enhanced[0].kind).toBe('decoration');
    const params = deck.slides[0].layoutParams as Record<string, unknown>;
    expect(['kpi', 'badge', 'timeline']).toContain((params.visualEnhancement as { kind: string }).kind);
  });

  it('相同输入重复调用结果一致（确定性）', () => {
    const a = buildValidatedDeck(planWithSparseContentPage(), {
      validationMode: 'legacy',
      sparseEnhancement: true,
    }).deck!;
    const b = buildValidatedDeck(planWithSparseContentPage(), {
      validationMode: 'legacy',
      sparseEnhancement: true,
    }).deck!;
    expect(JSON.stringify(a.slides[0].nodes)).toBe(JSON.stringify(b.slides[0].nodes));
  });
});
