/**
 * 后处理管线行为锁定测试（Phase 2 测试网）
 *
 * 目的：在 Phase 3 把 enforce* / ensure* / sanitize* / flatten* / wrap* 四大簇外置到
 * postprocess/ 子模块之前，先用「直接调用原型方法」的方式锁定这些行为，
 * 确保后续搬移不改变任何运行时输出。
 *
 * 调用方式：const svc = Object.create(HTMLPresentationAgent.prototype) as any;
 * 这些私有方法在编译后都是普通原型方法，可通过原型直接调用（见已通过的
 * postprocess-image-injection.test.ts 先例）。方法内部调用的 this.* 工具方法
 * （getFontStack / findClosingTagIndex / composeInheritedPStyle / darkenPrimaryColor /
 * resolveBgTone / isEffectiveClipText / normalizeHex）同样来自原型，可用。
 * 注意：isPlaceholderFontFamily 依赖实例字段（占位词表），Object.create 下该字段为
 * undefined 会报错；此测试用真实字体（非占位），故将其桩为 () => false 以还原正确判定。
 */

import { HTMLPresentationAgent } from '../html-presentation-agent';

const svc = Object.create(HTMLPresentationAgent.prototype) as any;
// 真实字体永非占位 → 桩为 false 还原 ok8 快路径正确行为（不影响其他测试）
svc.isPlaceholderFontFamily = () => false;

describe('postprocess · 颜色/对比度数学簇（精确断言）', () => {
  describe('parseColorToRgba（返回 [r,g,b,a] 元组）', () => {
    it('3 位 hex', () => expect(svc.parseColorToRgba('#fff')).toEqual([255, 255, 255, 1]));
    it('6 位 hex', () => expect(svc.parseColorToRgba('#ffffff')).toEqual([255, 255, 255, 1]));
    it('8 位 hex（alpha）', () =>
      expect(svc.parseColorToRgba('#ff000080')).toEqual([255, 0, 0, 128 / 255]));
    it('rgb()', () => expect(svc.parseColorToRgba('rgb(255,0,0)')).toEqual([255, 0, 0, 1]));
    it('rgba()', () => expect(svc.parseColorToRgba('rgba(255,0,0,0.5)')).toEqual([255, 0, 0, 0.5]));
    it('非法输入返回 null', () => expect(svc.parseColorToRgba('not-a-color')).toBeNull());
  });

  describe('compositeOver（fg:[r,g,b,a] / base:[r,g,b] 入参，返回舍入 [r,g,b]）', () => {
    it('白色 0.5 叠黑 = 灰 128', () => {
      expect(svc.compositeOver([255, 255, 255, 0.5], [0, 0, 0])).toEqual([128, 128, 128]);
    });
    it('相同颜色叠加不变', () => {
      expect(svc.compositeOver([10, 20, 30, 0.4], [10, 20, 30])).toEqual([10, 20, 30]);
    });
  });

  describe('relativeLuminance（[r,g,b] 入参）', () => {
    it('白 = 1', () => expect(svc.relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5));
    it('黑 = 0', () => expect(svc.relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5));
  });

  describe('contrastRatio（[r,g,b] 入参）', () => {
    it('黑/白 = 21', () =>
      expect(svc.contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1));
    it('同色 = 1', () =>
      expect(svc.contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5));
  });

  describe('isDecorativeLayer', () => {
    it('绝对定位+pointer-events:none = 装饰层', () =>
      expect(svc.isDecorativeLayer('position:absolute;pointer-events:none')).toBe(true));
    it('普通文字色 = 非装饰层', () => expect(svc.isDecorativeLayer('color:#000')).toBe(false));
  });

  describe('resolveEffectiveBgRgb（返回 [r,g,b] 元组）', () => {
    it('解析 background-color:#fff', () =>
      expect(svc.resolveEffectiveBgRgb('background-color:#fff')).toEqual([255, 255, 255]));
    it('非法返回 null', () => expect(svc.resolveEffectiveBgRgb('color:#fff')).toBeNull());
  });

  describe('resolveBgTone', () => {
    it('深底', () => expect(svc.resolveBgTone('background-color:#111')).toBe('dark'));
    it('浅底', () => expect(svc.resolveBgTone('background-color:#fff')).toBe('light'));
  });

  describe('needsContrastFix（fgToken + bgRgb 元组 + fontSize + fontWeight）', () => {
    it('黑底白字对比充足 = 不修', () =>
      expect(svc.needsContrastFix('#ffffff', [0, 0, 0], 18, 400)).toBe(false));
    it('极近灰阶对比不足 = 修', () =>
      expect(svc.needsContrastFix('#888888', [119, 119, 119], 18, 400)).toBe(true));
  });

  describe('hex 工具', () => {
    it('normalizeHex #fff → #ffffff', () => expect(svc.normalizeHex('#fff')).toBe('#ffffff'));
    it('hexToRgb #ffffff → 对象', () =>
      expect(svc.hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 }));
    it('hexToRgba #ffffff → rgba 字符串', () =>
      expect(svc.hexToRgba('#ffffff')).toBe('rgba(255, 255, 255, undefined)'));
    it('rgbStringToHex rgb(255,0,0)', () =>
      expect(svc.rgbStringToHex('rgb(255,0,0)')).toBe('#ff0000'));
  });

  describe('fontSizeOf / fontWeightOf（入参为 style Map）', () => {
    it('fontSizeOf', () =>
      expect(svc.fontSizeOf(new Map([['font-size', '24px']]))).toBe(24));
    it('fontWeightOf', () =>
      expect(svc.fontWeightOf(new Map([['font-weight', '700']]))).toBe(700));
  });
});

describe('postprocess · 颜色对比度执行簇（不变式断言）', () => {
  it('enforceHeadingColorOnLightBg：浅底上深色中性 heading 被升为主色深色变体', () => {
    const html = '<div style="background-color:#fff;"><h2 style="color:#374151;">标题</h2></div>';
    const out = svc.enforceHeadingColorOnLightBg(html, {
      primaryColor: '#7c3aed',
      primaryColorDarker: '#632ebe',
    });
    expect(out).not.toContain('#374151');
    expect(out).toContain('color:');
  });

  it('enforceHeadingColorOnLightBg：已为主色的 heading 不被破坏（只升不降）', () => {
    const html = '<div style="background-color:#fff;"><h2 style="color:#7c3aed;">标题</h2></div>';
    const out = svc.enforceHeadingColorOnLightBg(html, {
      primaryColor: '#7c3aed',
      primaryColorDarker: '#632ebe',
    });
    expect(out).toContain('#7c3aed');
  });

  it('enforceDarkBgTextContrast：深底内文字强制白色', () => {
    const html = '<div style="background-color:#111;"><p style="color:#374151;">正文</p></div>';
    const out = svc.enforceDarkBgTextContrast(html, '#7c3aed');
    expect(out).toContain('#FFFFFF');
  });

  it('enforceLightBgTextContrast：浅底白字被替换为深色变体', () => {
    const html = '<div style="background-color:#fff;"><p style="color:#FFFFFF;">正文</p></div>';
    const out = svc.enforceLightBgTextContrast(html, '#7c3aed');
    expect(out).not.toContain('#FFFFFF');
    expect(out).toContain('color:');
  });

  it('fixVerticalWritingLists：删除 writing-mode 声明', () => {
    const html = '<div style="writing-mode:vertical-rl;">竖排</div>';
    const out = svc.fixVerticalWritingLists(html);
    expect(out).not.toContain('writing-mode');
  });
});

describe('postprocess · 布局/DOM 簇（确定性 + 幂等断言）', () => {
  it('ensureOuterContainer：裸内容被包成 100%×100% 合规容器', () => {
    const out = svc.ensureOuterContainer('<h1>Hi</h1>');
    expect(out.startsWith('<div')).toBe(true);
    expect(out.endsWith('</div>')).toBe(true);
    expect(out).toContain('width:100%');
    expect(out).toContain('height:100%');
    expect(out).toContain('overflow:hidden');
    expect(out).toContain('box-sizing:border-box');
    expect(out).toContain('display:flex');
    expect(out).toContain('flex-direction:column');
    expect(out).toContain('background-color:#fff');
    expect(out).toContain('<h1>Hi</h1>');
  });

  it('ensureOuterContainer：8 特征齐全的真实字体容器幂等（ok8 快路径不改值）', () => {
    const compliant =
      '<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:&quot;Inter&quot;,sans-serif;">内容</div>';
    expect(svc.ensureOuterContainer(compliant)).toBe(compliant);
  });

  it('ensureImageProperWrapper：块级关闭标签后的裸 img 被包标准容器', () => {
    const input = '<div><p>text</p></div><img src="x.png"></div>';
    const out = svc.ensureImageProperWrapper(input);
    expect(out).toContain(
      '<div style="margin-top:24px;overflow:hidden;display:flex;align-items:stretch;min-height:0;flex:0 0 auto;"><img src="x.png"></div>',
    );
    expect(out).toContain('<p>text</p>');
  });

  it('enforceStretchAlignment：flex 容器缺 align-items 时补 stretch', () => {
    expect(svc.enforceStretchAlignment('<div style="display:flex;">x</div>')).toBe(
      '<div style="display:flex;;align-items:stretch">x</div>',
    );
  });

  it('enforceTextContainerStyles：flex:1 容器补 min-height/overflow:clip/min-width', () => {
    const out = svc.enforceTextContainerStyles('<div style="flex:1;">x</div>');
    expect(out).toContain('min-height:0');
    expect(out).toContain('overflow:clip');
    expect(out).toContain('min-width:0');
  });

  it('flattenMeaninglessNesting：无样式外层包裹 heading 被拍平', () => {
    expect(svc.flattenMeaninglessNesting('<div><h2>T</h2></div>')).toBe('<h2>T</h2>');
  });

  it('flattenMeaninglessNesting：纯双 div 包裹幂等（不破坏有意义嵌套）', () => {
    const input = '<div><div><h2>T</h2></div></div>';
    expect(svc.flattenMeaninglessNesting(input)).toBe(input);
  });

  it('ensureSemanticWrapping：容器内裸文本被包成 <p>', () => {
    const out = svc.ensureSemanticWrapping('<div>bare text here</div>');
    expect(out).toContain('<p style=');
    expect(out).toContain('bare text here');
  });

  it('ensureSemanticWrapping：已包 <p> 的内容幂等', () => {
    const input = '<div><p style="color:#374151;">text</p></div>';
    expect(svc.ensureSemanticWrapping(input)).toBe(input);
  });

  it('wrapTextNodes：容器内裸文本被包成 <p>', () => {
    const out = svc.wrapTextNodes('<div>bare text here</div>');
    expect(out).toContain('<p style=');
    expect(out).toContain('bare text here');
  });

  it('wrapTextNodes：已包 <p> 的容器幂等', () => {
    const input = '<div><p style="color:#374151;">text</p></div>';
    expect(svc.wrapTextNodes(input)).toBe(input);
  });

  it('composeInheritedPStyle：无父样式回落默认 24px', () => {
    expect(svc.composeInheritedPStyle(undefined)).toContain('font-size:24px');
  });

  it('composeInheritedPStyle：从父样式继承字号', () => {
    expect(svc.composeInheritedPStyle('font-size:30px;color:#123456')).toContain('font-size:30px;');
  });
});
