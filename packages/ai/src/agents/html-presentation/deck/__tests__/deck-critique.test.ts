import { describe, expect, it } from 'vitest';
import { DECK_IMAGE_PLACEHOLDER, type DeckSlide } from '@noppt/core/deck';
import { deckCritiqueContextFromDeck, describeDeckSlide } from '../deck-critique';

function slideWith(overrides: Partial<DeckSlide> = {}): DeckSlide {
  return {
    id: 'slide-1',
    pageType: 'content-image-left',
    title: '测试标题',
    nodes: [
      {
        kind: 'text',
        rect: { x: 48, y: 96, w: 600, h: 60 },
        role: 'title',
        paragraphs: [{ runs: [{ text: '测试标题', fontSize: 52, color: '#1F2937', bold: true }] }],
      },
      {
        kind: 'image',
        rect: { x: 48, y: 200, w: 500, h: 400 },
        src: DECK_IMAGE_PLACEHOLDER,
        alt: '配图',
        fit: 'cover',
      },
      {
        kind: 'group',
        rect: { x: 0, y: 0, w: 10, h: 10 },
        children: [
          {
            kind: 'shape',
            rect: { x: 1, y: 1, w: 2, h: 2 },
            shape: 'roundRect',
            fill: { type: 'solid', color: '#2563EB' },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('describeDeckSlide', () => {
  it('序列化文本节点含字号/颜色/角色/文本', () => {
    const d = describeDeckSlide(slideWith());
    expect(d).toContain('role=title');
    expect(d).toContain('fontSize=52');
    expect(d).toContain('color=#1F2937');
    expect(d).toContain('测试标题');
  });

  it('占位图节点标注为占位而非真实 URL', () => {
    const d = describeDeckSlide(slideWith());
    expect(d).toContain(`占位图(${DECK_IMAGE_PLACEHOLDER})`);
    expect(d).not.toContain('src=http');
  });

  it('真实图节点输出 src 而非占位标注', () => {
    const real = slideWith({
      nodes: [
        {
          kind: 'image',
          rect: { x: 0, y: 0, w: 10, h: 10 },
          src: 'https://cdn.example.com/p.png',
          fit: 'cover',
        },
      ],
    });
    const d = describeDeckSlide(real);
    expect(d).toContain('src=https://cdn.example.com/p.png');
    expect(d).not.toContain('占位图');
  });

  it('递归展开 group 子节点（缩进）', () => {
    const d = describeDeckSlide(slideWith());
    expect(d).toContain('- group');
    expect(d).toContain('shape(roundRect)');
    expect(d).toContain('fill=#2563EB');
  });

  it('标题缺省时回退到 plan.title', () => {
    const d = describeDeckSlide(slideWith({ title: undefined }), {
      title: '计划标题',
      pageType: 'content-image-left',
    } as any);
    expect(d).toContain('计划标题');
  });
});

describe('deckCritiqueContextFromDeck', () => {
  it('从 deck.theme 推导设计上下文', () => {
    const ctx = deckCritiqueContextFromDeck({
      theme: { primary: '#123456', fontFamily: 'X', style: 'tech' },
    } as any);
    expect(ctx.style).toBe('tech');
    expect(ctx.primaryColor).toBe('#123456');
    expect(ctx.fontFamily).toBe('X');
  });

  it('缺省字段回落默认值', () => {
    const ctx = deckCritiqueContextFromDeck({ theme: {} } as any);
    expect(ctx.style).toBe('business');
    expect(ctx.primaryColor).toBe('#2563eb');
  });
});
