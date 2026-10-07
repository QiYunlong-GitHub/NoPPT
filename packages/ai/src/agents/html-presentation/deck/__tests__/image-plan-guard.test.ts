import { describe, expect, it } from 'vitest';
import { DECK_IMAGE_PLACEHOLDER, isDeckImagePlaceholder } from '@noppt/core/deck';
import type { SlidePageType, SlidePlan } from '../../../../types';
import { layoutSlideNodes } from '../layout-templates';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import {
  NEVER_UPGRADE_FOR_IMAGE,
  applyDeckImageGuard,
  hasDeckImagePlaceholder,
  resolveDeckImageDecision,
  slideHasMeaningfulBodyNodes,
  stripDeckImagePlaceholders,
} from '../image-plan-guard';

function ctx() {
  return buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] });
}

function sp(pageType: SlidePageType, overrides?: Partial<SlidePlan>): SlidePlan {
  return {
    pageType,
    title: '测试标题',
    keyPoints: ['要点一：说明一', '要点二：说明二'],
    needsImage: false,
    ...overrides,
  };
}

describe('resolveDeckImageDecision', () => {
  it('结构页恒不配图（stripPlaceholder + needsImage=false）', () => {
    const d = resolveDeckImageDecision(sp('cover', { needsImage: true }), {
      imagePreference: 'content-only',
      imageEnabled: true,
    });
    expect(d.stripPlaceholder).toBe(true);
    expect(d.needsImage).toBe(false);
    expect(d.reason).toBe('structure-page');
  });

  it('imagePreference=none → 剥离', () => {
    const d = resolveDeckImageDecision(sp('content-cards', { needsImage: true }), {
      imagePreference: 'none',
      imageEnabled: true,
    });
    expect(d.stripPlaceholder).toBe(true);
    expect(d.reason).toBe('pref-none');
  });

  it('图片开关关闭 → 剥离', () => {
    const d = resolveDeckImageDecision(sp('content-cards', { needsImage: true }), {
      imagePreference: 'content-only',
      imageEnabled: false,
    });
    expect(d.stripPlaceholder).toBe(true);
    expect(d.reason).toBe('image-disabled');
  });

  it('plan.needsImage=true 的内容页 → 配图且不剥离', () => {
    const d = resolveDeckImageDecision(sp('content-image-left', { needsImage: true }), {
      imagePreference: 'content-only',
      imageEnabled: true,
    });
    expect(d.needsImage).toBe(true);
    expect(d.stripPlaceholder).toBe(false);
  });
});

describe('applyDeckImageGuard', () => {
  it('内容页在 content-only 下被升级为 content-image-left 并 needsImage=true', () => {
    const out = applyDeckImageGuard(sp('content-no-image'), {
      imagePreference: 'content-only',
      imageEnabled: true,
    });
    expect(out.pageType).toBe('content-image-left');
    expect(out.needsImage).toBe(true);
  });

  it('升级后 layoutSlideNodes 真正产出占位图节点', () => {
    const out = applyDeckImageGuard(sp('content-no-image'), {
      imagePreference: 'content-only',
      imageEnabled: true,
    });
    const nodes = layoutSlideNodes(out, ctx());
    const img = nodes.find((n) => n.kind === 'image');
    expect(img).toBeDefined();
    expect(isDeckImagePlaceholder((img as { src: string }).src)).toBe(true);
  });

  it('NEVER_UPGRADE 黑名单版式绝不升级（content-cards）', () => {
    expect(NEVER_UPGRADE_FOR_IMAGE.has('content-cards')).toBe(true);
    const out = applyDeckImageGuard(sp('content-cards'), {
      imagePreference: 'content-only',
      imageEnabled: true,
    });
    expect(out.pageType).toBe('content-cards');
  });

  it('结构页即便升级偏好下也不升带图', () => {
    const out = applyDeckImageGuard(sp('cover', { needsImage: true }), {
      imagePreference: 'all',
      imageEnabled: true,
    });
    expect(out.pageType).toBe('cover');
    expect(out.needsImage).toBe(false);
  });

  it('pref=none 强制 needsImage=false', () => {
    const out = applyDeckImageGuard(sp('content-cards', { needsImage: true }), {
      imagePreference: 'none',
      imageEnabled: true,
    });
    expect(out.needsImage).toBe(false);
  });

  it('主体文字不足时不升级', () => {
    const out = applyDeckImageGuard(sp('content-no-image', { title: '', keyPoints: [] }), {
      imagePreference: 'content-only',
      imageEnabled: true,
    });
    expect(out.pageType).toBe('content-no-image');
  });

  it('不修改入参对象（返回新对象）', () => {
    const input = sp('content-no-image');
    const out = applyDeckImageGuard(input, { imagePreference: 'content-only', imageEnabled: true });
    expect(out).not.toBe(input);
    expect(input.pageType).toBe('content-no-image');
  });
});

describe('slideHasMeaningfulBodyNodes', () => {
  it('标题+要点拼接 ≥ 6 字符为有意义', () => {
    expect(slideHasMeaningfulBodyNodes(sp('content-no-image'))).toBe(true);
  });
  it('空内容无意义', () => {
    expect(slideHasMeaningfulBodyNodes(sp('content-no-image', { title: '', keyPoints: [] }))).toBe(
      false,
    );
  });
});

describe('hasDeckImagePlaceholder / stripDeckImagePlaceholders', () => {
  const nodes = [
    { kind: 'text', rect: { x: 0, y: 0, w: 100, h: 40 }, text: '标题', role: 'title' } as any,
    { kind: 'image', rect: { x: 0, y: 60, w: 100, h: 80 }, src: DECK_IMAGE_PLACEHOLDER } as any,
  ];

  it('检测占位图节点', () => {
    expect(hasDeckImagePlaceholder(nodes)).toBe(true);
    expect(hasDeckImagePlaceholder([nodes[0]])).toBe(false);
  });

  it('剥离占位图节点（幂等，无占位时原样返回）', () => {
    const out = stripDeckImagePlaceholders(nodes);
    expect(out.find((n) => n.kind === 'image')).toBeUndefined();
    expect(out).toHaveLength(1);
    expect(stripDeckImagePlaceholders([nodes[0]])).toHaveLength(1);
  });
});

describe('planToDeck 向后兼容（imageEnabled 未传时不应用 guard）', () => {
  it('未传 imageEnabled 时 pageType 与 needsImage 保持原样', () => {
    const deck = planToDeck({
      title: 't',
      primaryColor: '#2563eb',
      slides: [sp('content-cards', { needsImage: true })],
    });
    expect(deck.slides[0].pageType).toBe('content-cards');
  });

  it('传入 imageEnabled=true + content-only 时内容页被升级', () => {
    const deck = planToDeck(
      { title: 't', primaryColor: '#2563eb', slides: [sp('content-no-image')] },
      { imageEnabled: true, imagePreference: 'content-only' },
    );
    expect(deck.slides[0].pageType).toBe('content-image-left');
  });
});
