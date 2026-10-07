import { describe, expect, it } from 'vitest';
import type { DeckTextNode } from '@noppt/core/deck';
import type { SlidePlan } from '../../../../types';
import { DEFAULT_DECK_LAYOUT_CONTEXT, layoutSlideNodes } from '../layout-templates';

function summaryPlan(overrides: Partial<SlidePlan> = {}): SlidePlan {
  return {
    pageType: 'summary',
    title: '总结',
    keyPoints: ['结论一', '行动二', '后续三'],
    needsImage: false,
    ...overrides,
  };
}

function textOf(node: DeckTextNode): string {
  return node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
}

describe('summary content ownership', () => {
  it('renders every visible summary item as an independently traceable node', () => {
    const plan = summaryPlan({
      summaryItems: [
        { contentId: 'summary-1', text: '结论一', role: 'point' },
        { contentId: 'summary-2', text: '行动二', role: 'action' },
        { contentId: 'summary-3', text: '后续三', role: 'takeaway' },
      ],
    });

    const nodes = layoutSlideNodes(plan, DEFAULT_DECK_LAYOUT_CONTEXT);
    const contentNodes = nodes.filter(
      (node): node is DeckTextNode => node.kind === 'text' && node.role !== 'title' && Boolean(node.contentId),
    );

    expect(contentNodes.map((node) => node.contentId)).toEqual(['summary-1', 'summary-2', 'summary-3']);
    expect(contentNodes.map(textOf)).toEqual(['结论一', '行动二', '后续三']);
  });

  it('preserves every legacy keyPoint with an explicit identity instead of silently dropping later items', () => {
    const nodes = layoutSlideNodes(summaryPlan(), DEFAULT_DECK_LAYOUT_CONTEXT);
    const visibleText = nodes
      .filter((node): node is DeckTextNode => node.kind === 'text' && node.role !== 'title')
      .flatMap((node) => [node.contentId, textOf(node)]);

    expect(visibleText).toEqual(expect.arrayContaining([
      expect.stringContaining('结论一'),
      expect.stringContaining('行动二'),
      expect.stringContaining('后续三'),
    ]));
    expect(nodes.filter((node) => node.kind === 'text' && node.contentId)).toHaveLength(3);
  });
});
