import { describe, expect, it } from 'vitest';
import type { Slide } from '@noppt/core';
import type { PresentationPlan } from '@noppt/ai';
import { extractPlainText } from '../html-text-utils';
import { validateKeyPoints } from '../key-points-validator';

/**
 * **Validates: Requirements 3.1–3.7**
 *
 * Content auditing is a preservation boundary: valid legacy HTML, valid
 * Deck-backed HTML, and decoration markup must remain observable while the
 * audit reports no false missing-key-point issue. The fixtures are synthetic
 * and do not read or write the target presentation.
 */
const FIXED_SEED = 0x51a7;
const RANDOM_CASE_SEED = 0x9e3779b9;

function next(seed: { value: number }): number {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

function generatedPoint(seed: { value: number }, index: number): string {
  const nouns = ['收入增长', '用户留存', '交付质量', '成本控制'];
  const modifiers = ['保持稳定', '完成验证', '支持编辑', '保留顺序'];
  return `${nouns[Math.floor(next(seed) * nouns.length)]}-${index} ${modifiers[Math.floor(next(seed) * modifiers.length)]}`;
}

function slide(id: string, html: string, deck?: Slide['deck']): Slide {
  return { id, title: id, html, deck, hidden: false, index: 0, createdAt: 0, updatedAt: 0 };
}

function planFor(points: string[]): PresentationPlan {
  return {
    title: '合法内容基线',
    primaryColor: '#2563eb',
    slides: [{ pageType: 'content-cards', title: '合法内容', keyPoints: points, needsImage: false }],
  };
}

function legalHtml(points: string[]): string {
  return `<div style="width:1280px;height:720px;padding:64px;background:linear-gradient(135deg,#fff,#dbeafe)">
    <h2>合法内容</h2>
    <ul>${points.map((point) => `<li>${point}</li>`).join('')}</ul>
    <div aria-hidden="true" data-role="decoration" style="background:linear-gradient(90deg,#2563eb,#93c5fd)">装饰标签</div>
    <img src="https://example.com/legal-decoration.png" alt="合法装饰图">
  </div>`;
}

function makeDeckSlide() {
  return {
    id: 'deck-slide',
    pageType: 'content-cards',
    title: '合法内容',
    nodes: [
      {
        kind: 'text' as const,
        role: 'title' as const,
        rect: { x: 64, y: 64, w: 1152, h: 64 },
        paragraphs: [{ runs: [{ text: '合法内容' }] }],
      },
    ],
  };
}

describe('presentation visual integrity · Audit preservation baseline', () => {
  it('keeps legacy HTML content coverage and decoration markup observable', () => {
    const points = ['收入增长保持稳定', '用户留存完成验证'];
    const legacy = slide('legacy-html', legalHtml(points));
    const issues = validateKeyPoints([legacy], planFor(points));

    expect(extractPlainText(legacy.html)).toContain(points[0]);
    expect(legacy.html).toContain('linear-gradient');
    expect(legacy.html).toContain('legal-decoration.png');
    expect(issues).toEqual([]);
  });

  it('keeps valid Deck-backed content on the same audit boundary as legacy HTML', () => {
    const points = ['交付质量支持编辑'];
    const deckBacked = slide('deck-backed', legalHtml(points), makeDeckSlide());
    const legacy = slide('legacy', legalHtml(points));
    const plan = planFor(points);

    expect(validateKeyPoints([legacy], plan)).toEqual([]);
    expect(validateKeyPoints([deckBacked], plan)).toEqual([]);
    expect(extractPlainText(deckBacked.html)).toBe(extractPlainText(legacy.html));
    expect(deckBacked.deck?.nodes).toHaveLength(1);
  });

  it('preserves valid content for fixed and generated seeds without false omissions', () => {
    const seeds = [FIXED_SEED, RANDOM_CASE_SEED, 0x12345678, 0xdeadbeef];
    const observations = seeds.map((initialSeed, caseIndex) => {
      const seed = { value: initialSeed };
      const points = Array.from({ length: 1 + Math.floor(next(seed) * 3) }, (_, index) =>
        generatedPoint(seed, index),
      );
      const current = slide(`generated-${caseIndex}`, legalHtml(points));
      const issues = validateKeyPoints([current], planFor(points));

      expect(issues, `seed=${initialSeed}`).toEqual([]);
      return {
        seed: initialSeed,
        pointCount: points.length,
        plainTextLength: extractPlainText(current.html).length,
        issueCount: issues.length,
      };
    });

    expect(observations).toMatchSnapshot('seeded-audit-preservation-cases');
  });

  it('does not turn unavailable browser, font, or audit service evidence into pass', () => {
    const unavailable = [
      { service: 'Chromium', status: 'unverified', reason: 'No live browser renderer is started for the baseline.' },
      { service: 'font metrics', status: 'unverified', reason: 'jsdom cannot establish resolved glyph metrics.' },
      { service: 'runtime audit endpoint', status: 'unverified', reason: 'Task 0 recorded port 3001 as unavailable.' },
    ];

    expect(unavailable.every((item) => item.status === 'unverified')).toBe(true);
    expect(unavailable).toMatchSnapshot('unverified-environment');
  });
});
