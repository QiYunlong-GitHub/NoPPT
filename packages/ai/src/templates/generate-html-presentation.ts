import { PRESENTATION_PLANNING_PROMPT } from './prompts/planning.prompt';
import { renderBadgeIcon } from './svg-icons';
import { getIcons, getEmojiBigIcon, getCircleIcon, getCompareRightIcon, getCompareLeftIcon, buildLi, getSemanticIconByIndex } from './icons';
import type { TemplateCtx } from './pages/types';
import { buildCoverSections } from './pages/cover';
import { buildNavSections } from './pages/nav';
import { buildContentSections } from './pages/content';
import { buildDataSections } from './pages/data';
import { buildCompareSections } from './pages/compare';
import { buildClosingSections } from './pages/closing';
export * from './prompts';

/**
 * 演示文稿 HTML 模板与提示词。
 *
 * 说明：纯提示词常量已按职责外置到 ./prompts 下（规划 / 单页 HTML / 修改），
 * 本文件负责页面模板生成逻辑，并通过再导出保持对外具名导出完全不变。
 *
 * ⚠ 重构红线：getFontStackLocal 必须保留在本文件内。
 *   agents/fontstack-dual-source-sync.test.ts 会按路径读取本文件源码文本，
 *   与 html-presentation-agent.ts#getFontStack 做逐字节比对（漂移回归守卫）。
 */

/**
 * S2 · 本地字体栈工具：根据 fontFamily (sans/serif/mono) 输出不同的 CSS font-family 栈。
 * 和 packages/ai/src/agents/html-presentation-agent.ts 中 getFontStack 保持内容一致（双份定义以避免跨模块依赖）。
 *
 * ★ 漂移回归守卫：三分支（sans/serif/mono）返回值必须与 html-presentation-agent.ts#getFontStack 逐字节全等。
 *   CI 通过 fontstack-dual-source-sync.test.ts 保证此约束，修改任意一处时必须同步另一处并过测试。
 *   长期 TODO：抽 packages/shared/fonts.ts 常量，两处 import 同一个对象（避免双份）。
 * ★ 修改同步点：
 *   - templates: packages/ai/src/templates/generate-html-presentation.ts#getFontStackLocal
 *   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack
 */

export function getFontStackLocal(family: 'sans' | 'serif' | 'mono' = 'sans'): string {
  switch (family) {
    case 'serif':
      return "'Noto Serif SC', 'Source Han Serif SC', Georgia, 'Times New Roman', Times, serif";
    case 'mono':
      return "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace";
    case 'sans':
    default:
      return "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Segoe UI', Roboto, sans-serif";
  }
}


function roundTo8(n: number): number {
  return Math.round(n / 8) * 8;
}

function computePadding(slideWidth: number, slideHeight: number): { x: number; y: number } {
  const baseX = 64,
    baseY = 48;
  const scale = Math.min(slideWidth / 1280, slideHeight / 720);
  return { x: roundTo8(Math.max(32, baseX * scale)), y: roundTo8(Math.max(24, baseY * scale)) };
}

const GRAD_TEXT =
  'background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';

export function buildTemplateContext(
  slideWidth = 1280,
  slideHeight = 720,
  iconStyle: string = 'auto',
  fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
): TemplateCtx {
  const pad = computePadding(slideWidth, slideHeight);
  const PX = pad.x,
    PY = pad.y;
  const P = '{{PRIMARY_COLOR}}';
  const PD = '{{PRIMARY_COLOR_DARKER}}';
  const FONT_STACK_ACTIVE = getFontStackLocal(fontFamily);
  const GRAD = `linear-gradient(135deg,${P},${PD})`;
  const OUTER = `width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${PY}px ${PX}px;display:flex;flex-direction:column;background-color:{{CANVAS_BG_COLOR}};font-family:${FONT_STACK_ACTIVE}`;
  const GRAD_H2 = `font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;letter-spacing:-0.01em;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT}`;
  // 封面海报级 H1：超字号+900字重+多层发光+渐变描边（注意 text-shadow 与 -webkit-text-fill-color:transparent 不冲突，阴影在透明字外发光）
  const GRAD_H1 = `font-size:92px;font-weight:900;margin:0 0 32px 0;line-height:1.1;letter-spacing:0.01em;width:100%;text-align:center;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT}-webkit-text-stroke:1.5px ${P}80;text-shadow:0 4px 30px ${P}50, 0 0 70px ${P}30, 0 0 140px ${P}15;`;
  const GRAD_SUMMARY = `font-size:72px;font-weight:800;margin:0 0 24px 0;line-height:1.1;letter-spacing:0.01em;text-align:center;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT}text-shadow:0 4px 24px ${P}45;`;
  // 渐变文字 for H3 卡片标题
  const GRAD_H3_CARD = `background:linear-gradient(135deg,${P},${PD});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`;

  const icon0 = getIcons(iconStyle, 0, P, PD);
  const icon1 = getIcons(iconStyle, 1, P, PD);
  const icon2 = getIcons(iconStyle, 2, P, PD);
  const icon3 = getIcons(iconStyle, 3, P, PD);
  const icon4 = getIcons(iconStyle, 4, P, PD);

  const li0 = (text: string) => buildLi(icon0, text);
  const li1 = (text: string) => buildLi(icon1, text);
  const li2 = (text: string) => buildLi(icon2, text);
  const li3 = (text: string) => buildLi(icon3, text);
  const li4 = (text: string) => buildLi(icon4, text);

  // 根据iconStyle选择大图标类型
  // - emoji: emoji圆角背景
  // - line: 线性SVG图标 + 浅色圆角背景
  // - filled: 面性SVG图标 + 渐变实心背景
  // - 其他（numbered/bullet/lettered/auto）: 数字渐变圆
  const useEmojiBigIcons = iconStyle === 'emoji';
  const useLineBigIcons = iconStyle === 'line' || iconStyle === 'auto';
  const useFilledBigIcons = iconStyle === 'filled';

  const getBigIcon = (idx: number, size: number, iconSize: number): string => {
    if (useEmojiBigIcons) return getEmojiBigIcon(size, Math.round(iconSize * 1.27), idx, P);
    if (useLineBigIcons) {
      const key = getSemanticIconByIndex(idx);
      return renderBadgeIcon(key, 'line', size, iconSize, P, 'rounded');
    }
    if (useFilledBigIcons) {
      const key = getSemanticIconByIndex(idx);
      return renderBadgeIcon(key, 'filled', size, iconSize, P, 'rounded');
    }
    return getCircleIcon(size, Math.round(iconSize * 0.82), idx + 1, P, PD);
  };

  const tocIcon0 = getBigIcon(0, 44, 20);
  const tocIcon1 = getBigIcon(1, 44, 20);
  const tocIcon2 = getBigIcon(2, 44, 20);

  const cardIcon0 = getBigIcon(0, 48, 22);
  const cardIcon1 = getBigIcon(1, 48, 22);
  const cardIcon2 = getBigIcon(2, 48, 22);
  const cardIcon3 = getBigIcon(3, 48, 22);

  const listCardIcon0 = getBigIcon(0, 40, 20);
  const listCardIcon1 = getBigIcon(1, 40, 20);
  const listCardIcon2 = getBigIcon(2, 40, 20);
  const listCardIcon3 = getBigIcon(3, 40, 20);

  const gridCardIcon0 = getBigIcon(0, 36, 18);
  const gridCardIcon1 = getBigIcon(1, 36, 18);
  const gridCardIcon2 = getBigIcon(2, 36, 18);
  const gridCardIcon3 = getBigIcon(3, 36, 18);

  const tlIcon0 = getBigIcon(0, 40, 18);
  const tlIcon1 = getBigIcon(1, 40, 18);
  const tlIcon2 = getBigIcon(2, 40, 18);

  const zigzagIcon1 = getBigIcon(7, 64, 32);
  const zigzagIcon2 = getBigIcon(6, 64, 32);

  const cmpRight = getCompareRightIcon(P, PD);
  const cmpLeft = getCompareLeftIcon();

  return {
    pad, PX, PY, P, PD, FONT_STACK_ACTIVE, GRAD, OUTER, GRAD_H2, GRAD_H1, GRAD_SUMMARY, GRAD_H3_CARD, GRAD_TEXT,
    icon0, icon1, icon2, icon3, icon4,
    li0, li1, li2, li3, li4,
    useEmojiBigIcons, useLineBigIcons, useFilledBigIcons, getBigIcon,
    tocIcon0, tocIcon1, tocIcon2,
    cardIcon0, cardIcon1, cardIcon2, cardIcon3,
    listCardIcon0, listCardIcon1, listCardIcon2, listCardIcon3,
    gridCardIcon0, gridCardIcon1, gridCardIcon2, gridCardIcon3,
    tlIcon0, tlIcon1, tlIcon2,
    zigzagIcon1, zigzagIcon2,
    cmpRight, cmpLeft,
  };
}

export function getPageTemplates(
  slideWidth = 1280,
  slideHeight = 720,
  iconStyle: string = 'auto',
  fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
): string {
  const ctx = buildTemplateContext(slideWidth, slideHeight, iconStyle, fontFamily);
  const map = {
    ...buildCoverSections(ctx),
    ...buildNavSections(ctx),
    ...buildContentSections(ctx),
    ...buildDataSections(ctx),
    ...buildCompareSections(ctx),
    ...buildClosingSections(ctx),
  };
  const ordered = Object.keys(map).map(Number).sort((a, b) => a - b).map((k) => map[k]);
  return '\n' + ordered.join('\n');
}

export const PAGE_TEMPLATES = getPageTemplates(1280, 720, 'auto', 'sans');

const MINIMAL_TEMPLATE_KIT = `当前页型无专属模板，请套用以下通用结构（单页优雅呈现；所有彩色元素仅使用 {{PRIMARY_COLOR}} / {{PRIMARY_COLOR_DARKER}} 及其透明度变体 + 中性灰阶）：
\`\`\`html
<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:{{CANVAS_BG_COLOR}};">
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;letter-spacing:-0.01em;overflow-wrap:break-word;word-break:break-word;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">页面标题</h2>
  <div style="pointer-events:none;width:80px;height:6px;background:{{PRIMARY_COLOR}};border-radius:3px;margin-bottom:24px;"></div>
  <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;justify-content:center;">
    <li style="display:flex;align-items:center;gap:12px;padding:16px 24px;border-radius:12px;background:{{PRIMARY_COLOR}}08;border:1px solid {{PRIMARY_COLOR}}24;overflow-wrap:break-word;word-break:break-word;min-width:0;"><span style="font-size:18px;line-height:1.7;color:#374151;flex:1;">要点一</span></li>
    <li style="display:flex;align-items:center;gap:12px;padding:16px 24px;border-radius:12px;background:#F9FAFB;border:1px solid #E5E7EB;overflow-wrap:break-word;word-break:break-word;min-width:0;"><span style="font-size:18px;line-height:1.7;color:#374151;flex:1;">要点二</span></li>
    <li style="display:flex;align-items:center;gap:12px;padding:16px 24px;border-radius:12px;background:{{PRIMARY_COLOR}}08;border:1px solid {{PRIMARY_COLOR}}24;overflow-wrap:break-word;word-break:break-word;min-width:0;"><span style="font-size:18px;line-height:1.7;color:#374151;flex:1;">要点三</span></li>
  </ul>
</div>
\`\`\``;

/**
 * 按 pageType 过滤返回对应模板（baseTypes 全覆盖基础 11 + L1 高级 5，精确 section 切取）。
 * 目标：减少注入模板的冗余字符 ~60-70%，降低 prompt token。
 *
 * 单测思路：
 * - 取 16 个页型（cover/toc/summary、各 content-*、5 个 L1 高级）调用本函数，断言返回串仅含目标 section 标题、不含其他 section 标题；
 * - 'content-foo' 等不在 baseTypes 的未知页型：断言返回 === MINIMAL_TEMPLATE_KIT 且触发 console.warn；
 * - content-* 内容页返回串应额外包含「封面装饰参考」段头（cover/toc/summary 本身不含）。
 */

export function getPageTemplatesByPageType(
  pageType: string | undefined,
  slideWidth: number = 1280,
  slideHeight: number = 720,
  iconStyle: string = 'auto',
  fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
): string {
  const all = getPageTemplates(slideWidth, slideHeight, iconStyle, fontFamily);
  if (!pageType) return all; // 兜底：pageType 缺失时返回全部，避免模型缺少参考
  const normalized = String(pageType).trim().toLowerCase();
  // 页型 → section 标题匹配关键词（heading 用能唯一匹配模板 section 标题的关键词）
  const baseTypes: Record<string, string[]> = {
    cover: ['cover'],
    toc: ['toc'],
    summary: ['summary'],
    'content-image-left': ['content-image-left'],
    'content-image-right': ['content-image-right'],
    'content-image-top': ['content-image-top'],
    'content-no-image': ['content-no-image'],
    'content-cards': ['content-cards'],
    'content-compare': ['content-compare'],
    'content-timeline': ['content-timeline'],
    'content-table': ['content-table'],
    'content-zigzag': ['content-zigzag'],
    'comparison-deep-dive': ['comparison-deep-dive'],
    'content-value-showcase': ['content-value-showcase'],
    'content-stats-highlight': ['content-stats-highlight'],
    'content-image-background': ['content-image-background'],
    'content-quote': ['content-quote'],
    // ===== FR-18 §18.1 / §18.5 扩展 =====
    // 新 Layout 暂无独立 slide 级 HTML 模板段落；映射到结构最相近的既有段落作为参考骨架，
    // 详细结构约束由「页面类型说明」区（PRESENTATION_PLANNING_PROMPT）的 ### content-* 段落给出。
    'content-flowchart': ['content-cards'],
    'content-org-chart': ['content-cards'],
    'content-pyramid': ['content-cards'],
    'content-matrix': ['content-cards'],
    'content-three-section': ['content-no-image'],
    'content-process-steps': ['content-cards'],
    'content-icon-grid': ['content-cards'],
    'content-section-divider': ['content-no-image'],
    'content-testimonial': ['content-no-image'],
    'content-chart-bar': ['content-cards'],
    'content-chart-line': ['content-cards'],
    'content-chart-pie': ['content-cards'],
    'content-chart-donut': ['content-cards'],
    'content-cycle': ['content-cards'],
    'content-dashboard': ['content-cards'],
    'content-architecture': ['content-org-chart'],
  };
  const headings = baseTypes[normalized];
  if (!headings) {
    // 弱兜底：未知 pageType（不在 baseTypes）→ 注入最小模板集，不再 return all
    console.warn('[TEMPLATE] 未知页型:' + pageType + '，已注入最小模板集，请在 baseTypes 补充');
    return MINIMAL_TEMPLATE_KIT;
  }

  // 通用切取：对每个 heading 关键词匹配所有同名 section（用 exec 处理 content-cards / content-image-top 等两个同名标题），按原始顺序拼接
  const extracted = extractSections(all, headings);
  if (extracted.length === 0) {
    // 已知页型但模板区无匹配 section（如 content-quote 暂无专属段）：同样走最小集，避免全量回归
    console.warn(
      '[TEMPLATE] 页型"' +
        pageType +
        '"在模板区无匹配 section，已注入最小模板集，请在 baseTypes 补充对应模板段',
    );
    return MINIMAL_TEMPLATE_KIT;
  }

  // content 内容页额外注入封面 section 作为「装饰参考」（仍是精确 section 切取，不回归全量）
  if (!['cover', 'toc', 'summary'].includes(normalized)) {
    const coverSections = extractSections(all, ['cover']);
    if (coverSections.length) {
      extracted.push(
        '【封面装饰参考 · 仅参考其装饰性元素/版式手法，勿整页照搬，正文遵守其他红线】\n' +
          coverSections.join('\n\n'),
      );
    }
  }
  return extracted.join('\n\n');
}

/**
 * 对模板串按 heading 关键词切取所有匹配的 section，按原始出现顺序返回并去重。
 * 用 `regex.exec` 配合全局标志（而非 matchAll）规避低版本 TS lib 的差异。
 */

function extractSections(all: string, headings: string[]): string[] {
  const collected: Array<{ index: number; text: string }> = [];
  for (const tag of headings) {
    const re = new RegExp(
      `(###\\s+\\*?\\*?.*?${escapeReg(tag)}[\\s\\S]*?)(?=\\n###\\s|\\n\`\`\`\\s*$|$)`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(all)) !== null) {
      collected.push({ index: m.index, text: m[0] });
      // 避免 matchAll 找不到下一段时死循环（lookahead 不消费，需手动推进）
      if (re.lastIndex === m.index) re.lastIndex = m.index + 1;
    }
  }
  collected.sort((a, b) => a.index - b.index);
  const seen = new Set<number>();
  const out: string[] = [];
  for (const c of collected) {
    if (!seen.has(c.index)) {
      seen.add(c.index);
      out.push(c.text);
    }
  }
  return out;
}


function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export const HTML_PRESENTATION_GENERATION_PROMPT = PRESENTATION_PLANNING_PROMPT;
export const HTML_PRESENTATION_FROM_REFERENCE_PROMPT = PRESENTATION_PLANNING_PROMPT;
