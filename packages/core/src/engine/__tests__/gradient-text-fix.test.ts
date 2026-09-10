import { describe, it, expect } from 'vitest';
import {
  isEffectiveClipText,
  fixGradientTextDeclarationOrder,
  applyCompositionGuard,
  type ReferenceComposition,
} from '../visual-fixes';

// 现场报文 05-content1-response.html 的问题 H1：background 简写写在 clip 之后 → 黑块 + 透明字
const BROKEN_H1 =
  '<h1 style="font-size:92px;font-weight:900;margin:0;line-height:1.1;letter-spacing:-0.02em;color:#22223b;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;background:linear-gradient(135deg,#22223b,#5c5c72);text-shadow:0 4px 30px rgba(255,77,109,0.3);">标题</h1>';

describe('fixGradientTextDeclarationOrder · 黑块标题修复（pres_mtrcm1nx 现场复现）', () => {
  it('isEffectiveClipText：background 简写覆盖 clip 时判为无效渐变文字', () => {
    expect(isEffectiveClipText(BROKEN_H1.match(/style="([^"]*)"/)![1])).toBe(false);
    expect(isEffectiveClipText('background:linear-gradient(135deg,#ff4d6d,#c9184a);-webkit-background-clip:text;background-clip:text;')).toBe(true);
  });

  it('深色→深色渐变字降级为纯色（保留参考标题色 #22223b，删除黑块与透明填充）', () => {
    const fixed = fixGradientTextDeclarationOrder(BROKEN_H1, { titleColor: '#22223b', primaryColor: '#ff4d6d' });
    expect(fixed).not.toMatch(/background\s*:\s*linear-gradient\([^)]*#22223b[^)]*#5c5c72/i);
    expect(fixed).not.toMatch(/-webkit-text-fill-color\s*:\s*transparent/i);
    expect(fixed).not.toMatch(/background-clip\s*:\s*text/i);
    expect(fixed).toMatch(/color\s*:\s*#22223b/i);
    // text-shadow 装饰保留，不破坏海报级冲击力
    expect(fixed).toMatch(/text-shadow/);
  });

  it('有效主色渐变文字保持原样（幂等，不被降级）', () => {
    const ok = '<h1 style="background:linear-gradient(135deg,#ff4d6d,#c9184a);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">B</h1>';
    expect(fixGradientTextDeclarationOrder(ok, { primaryColor: '#ff4d6d' })).toBe(ok);
  });

  it('声明顺序错乱但有效时归一（background 简写前置）', () => {
    const reordered = '-webkit-background-clip:text;background:linear-gradient(135deg,#ff4d6d,#c9184a);background-clip:text;-webkit-text-fill-color:transparent;';
    const fixed = fixGradientTextDeclarationOrder(`<h1 style="${reordered}">X</h1>`, { primaryColor: '#ff4d6d' });
    expect(fixed.indexOf('background:linear-gradient')).toBeLessThan(fixed.indexOf('background-clip:text'));
  });
});

describe('applyCompositionGuard · 左对齐参考禁用居中三件套', () => {
  const centeredCover =
    '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-color:#fff;"><h1 style="font-size:80px;">A</h1><ul><li>1</li></ul></div>';

  it('参考 left-aligned：移除根容器居中三件套', () => {
    const guarded = applyCompositionGuard(centeredCover, 'left-aligned' as ReferenceComposition);
    expect(guarded).not.toMatch(/justify-content\s*:\s*center/i);
    expect(guarded).not.toMatch(/align-items\s*:\s*center/i);
    expect(guarded).not.toMatch(/text-align\s*:\s*center/i);
  });

  it('未提供构图且页面含内容标记时保守移除（避免内容页被强制居中）', () => {
    const guarded = applyCompositionGuard(centeredCover);
    expect(guarded).not.toMatch(/justify-content\s*:\s*center/i);
  });

  it('参考 centered 时保留居中', () => {
    const guarded = applyCompositionGuard(centeredCover, 'centered' as ReferenceComposition);
    expect(guarded).toMatch(/justify-content\s*:\s*center/i);
  });

  it('纯标题封面（无内容标记）保守模式不误删居中', () => {
    const pureCover =
      '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;"><h1>A</h1></div>';
    const guarded = applyCompositionGuard(pureCover);
    expect(guarded).toMatch(/justify-content\s*:\s*center/i);
  });
});
