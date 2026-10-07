import { describe, expect, it } from 'vitest';
import type { PresentationPlan } from '../../../../types';
import { buildValidatedDeck, planToDeck } from '../plan-to-deck';

const legacyPlan: PresentationPlan = {
  title: 'Legacy deck',
  primaryColor: '#2563eb',
  slides: [
    {
      pageType: 'content-cards',
      title: '策略',
      keyPoints: ['保留整句策略，不得静默丢弃'],
      needsImage: false,
    },
    {
      pageType: 'summary',
      title: '总结',
      keyPoints: ['结论一', '行动二'],
      needsImage: false,
    },
  ],
};

describe('validated plan-to-deck contract', () => {
  it('returns structured issues and no strict deck for invalid required content', () => {
    const result = buildValidatedDeck({
      title: 'Invalid',
      primaryColor: '#2563eb',
      slides: [
        {
          pageType: 'content-stats-highlight',
          title: '指标',
          keyPoints: [],
          metricItems: [{ kind: 'metric', contentId: 'm1', order: 0, label: '', value: '' }],
          needsImage: false,
        },
      ],
    });

    expect(result.status).toBe('fail');
    expect(result.deck).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === 'empty_required_text')).toBe(true);
    expect(result.issues[0]).toMatchObject({ slideIndex: 0, recoverable: false });
  });

  it('keeps legacy keyPoints readable and identity-traceable without empty placeholders', () => {
    const result = buildValidatedDeck(legacyPlan, { validationMode: 'legacy' });
    expect(result.deck).toBeDefined();
    expect(result.normalizedPlan.slides[0].cardItems?.[0].body).toBe('保留整句策略，不得静默丢弃');
    expect(result.normalizedPlan.slides[1].summaryItems).toHaveLength(2);
    expect(result.deck?.slides.flatMap((slide) => slide.nodes).some((node) => node.contentId)).toBe(true);
  });

  it('keeps the existing bare Deck API compatible for safe legacy plans', () => {
    expect(planToDeck(legacyPlan).slides).toHaveLength(2);
  });
});
