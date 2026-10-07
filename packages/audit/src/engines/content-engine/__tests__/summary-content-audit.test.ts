import { describe, expect, it } from 'vitest';
import type { PresentationPlan } from '@noppt/ai';
import type { Slide } from '@noppt/core';import { compareContentCollections, type ContentManifestItem } from '../compare-content';
import { validateKeyPoints } from '../key-points-validator';

function slide(html: string): Slide {
  return {
    id: 'summary-slide',
    title: '总结',
    html,
    hidden: false,
    index: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function planFor(keyPoint: string, omission?: PresentationPlan['slides'][number]['omissions']): PresentationPlan {
  return {
    title: '内容审计',
    primaryColor: '#2563eb',
    slides: [{
      pageType: 'summary',
      title: '总结',
      keyPoints: [keyPoint],
      needsImage: false,
      omissions: omission,
    }],
  };
}

describe('summary key-point content audit', () => {
  it('distinguishes exact, partial, and missing coverage with structured summaries', () => {
    const exact = validateKeyPoints([slide('<div>收入增长保持稳定</div>')], planFor('收入增长保持稳定'));
    const partial = validateKeyPoints([slide('<div>收入增长</div>')], planFor('收入增长保持稳定'));
    const missing = validateKeyPoints([slide('<div>用户留存完成验证</div>')], planFor('收入增长保持稳定'));

    expect(exact).toEqual([]);
    expect(partial).toEqual([
      expect.objectContaining({
        ruleId: 'keypoint-partial',
        metadata: expect.objectContaining({
          contentId: expect.any(String),
          expectedSummary: '收入增长保持稳定',
          observedSummary: '收入增长',
          coverage: expect.any(Number),
          omissionReason: 'partial_match',
        }),
      }),
    ]);
    expect(missing).toEqual([
      expect.objectContaining({
        ruleId: 'keypoint-missing',
        metadata: expect.objectContaining({
          contentId: expect.any(String),
          expectedSummary: '收入增长保持稳定',
          observedSummary: '',
          coverage: 0,
          omissionReason: 'silent_drop',
        }),
      }),
    ]);
  });

  it('escalates an empty required key point with structured omission metadata', () => {
    const issues = validateKeyPoints([slide('<div>总结</div>')], planFor(''));

    expect(issues).toEqual([
      expect.objectContaining({
        ruleId: 'keypoint-empty',
        severity: 'error',
        metadata: expect.objectContaining({
          contentId: expect.any(String),
          expectedSummary: '',
          observedSummary: '',
          coverage: 0,
          omissionReason: 'empty_required_text',
        }),
      }),
    ]);
  });

  it('accepts an explicit omission without reporting it as a silent drop', () => {
    const issues = validateKeyPoints(
      [slide('<div>结论保留在候选修复报告中</div>')],
      planFor('收入增长保持稳定', [{
        contentId: 'summary-1',
        originalText: '收入增长保持稳定',
        reason: '内容由候选审核明确省略',
        status: 'omitted',
      }]),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        ruleId: 'keypoint-omitted',
        severity: 'warn',
        metadata: expect.objectContaining({
          contentId: 'summary-1',
          expectedSummary: '收入增长保持稳定',
          observedSummary: '',
          coverage: 0,
          omissionReason: '内容由候选审核明确省略',
        }),
      }),
    ]);
  });

  it('excludes decoration text from observed required content', () => {
    const issues = validateKeyPoints([
      slide('<div data-role="decoration">收入增长保持稳定</div>'),
    ], planFor('收入增长保持稳定'));

    expect(issues).toEqual([
      expect.objectContaining({
        ruleId: 'keypoint-missing',
        metadata: expect.objectContaining({
          observedSummary: '',
          omissionReason: 'silent_drop',
        }),
      }),
    ]);
  });
});

const manifest = (overrides: Partial<ContentManifestItem> = {}): ContentManifestItem => ({
  contentId: 'summary-1',
  text: '收入增长保持稳定',
  role: 'summary',
  order: 0,
  ownership: 'summary',
  required: true,
  ...overrides,
});

describe('three-source content parity audit', () => {
  it('compares plan, Deck, and HTML identity/order/role/ownership while ignoring decoration', () => {
    const planItems = [manifest()];
    const deckItems = [manifest(), manifest({ contentId: 'decoration-1', text: '装饰标签', role: 'decoration', required: false, decoration: true })];
    const htmlItems = [manifest(), manifest({ contentId: 'decoration-1', text: '装饰标签', role: 'decoration', required: false, decoration: true })];

    expect(compareContentCollections({ plan: planItems, deck: deckItems, html: htmlItems })).toMatchObject({
      status: 'pass',
      issues: [],
    });
  });

  it('reports identity, order, role, and ownership mismatches as structured issues', () => {
    const result = compareContentCollections({
      plan: [manifest(), manifest({ contentId: 'summary-2', text: '需要协同应对', order: 1, ownership: 'summary' })],
      deck: [manifest({ role: 'body' }), manifest({ contentId: 'summary-2', text: '需要协同应对', order: 0, ownership: 'left' })],
      html: [manifest({ contentId: 'summary-2', text: '需要协同应对', order: 1, ownership: 'summary' })],
    });

    expect(result.status).toBe('fail');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'identity_mismatch',
      'order_mismatch',
      'role_mismatch',
      'ownership_mismatch',
    ]));
    expect(result.issues.every((issue) => issue.contentId || issue.source)).toBe(true);
  });

  it('keeps Deck and HTML content order stable even when decoration is interleaved', () => {
    const result = compareContentCollections({
      plan: [manifest(), manifest({ contentId: 'summary-2', text: '需要协同应对', order: 1 })],
      deck: [manifest({ contentId: 'decoration-1', text: '装饰', role: 'decoration', required: false, decoration: true }), manifest(), manifest({ contentId: 'summary-2', text: '需要协同应对', order: 1 })],
      html: [manifest(), manifest({ contentId: 'decoration-1', text: '装饰', role: 'decoration', required: false, decoration: true }), manifest({ contentId: 'summary-2', text: '需要协同应对', order: 1 })],
    });

    expect(result.status).toBe('pass');
    expect(result.observedContentIds).toEqual(['summary-1', 'summary-2']);
  });
});
