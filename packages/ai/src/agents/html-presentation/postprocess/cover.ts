/**
 * PostProcess 簇A-封面：封面海报样式 / 左右 55-45 与卡片条 / 卡片文字比例 / row 图片 margin（从 html-presentation-agent.ts 外置）。
 * 依赖：色与对比度工具来自 ./color、./contrast；DOM 结构工具来自 ./dom；parseStyleDeclarations 来自 @noppt/core。
 */
import { findClosingTagIndex, findDirectChildElements } from './dom';
import { darkenPrimaryColor, fontSizeOf, fontWeightOf, isDecorativeLayer, needsContrastFix, normalizeHex, relativeLuminance, resolveBgTone } from './color';
import { parseStyleDeclarations, type ReferenceComposition } from '@noppt/core';
import { formatBeijingTime } from '../../../providers/base';

export function fixRowImageMargins(html: string): string {
  return html.replace(
    /(<div[^>]*style=")([^"]*)("[^>]*>\s*<img[^>]*data-image-ratio)/gi,
    (full, pre: string, styleBody: string, rest: string) => {
      const bm = /flex:\s*0\s+0\s+(\d{1,3})%/.exec(styleBody);
      const pct = bm ? parseInt(bm[1], 10) : 0;
      if (!(pct === 45 || pct === 50 || pct === 55)) return full; // 仅 row 两列切分
      const next = styleBody.replace(/(\s*(?:margin-top|margin-bottom)\s*:\s*[^;"']*?;?)/gi, '');
      if (next === styleBody) return full;
      return `${pre}${next}${rest}`;
    },
  );
}

export function countDecorativeBlobs(html: string): number {
  const divRe = /<div\b([^>]*)>/gi;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(html)) !== null) {
    const attrs = m[1];
    const styleMatch = /\bstyle\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (!styleMatch) continue;
    const style = styleMatch[1];
    const isAbsolute =
      /position\s*:\s*absolute/i.test(style) || /position\s*:\s*fixed/i.test(style);
    const hasGradOrClip = /radial-gradient|linear-gradient|clip-path/i.test(style);
    if (!isAbsolute || !hasGradOrClip) continue;
    // 该 div 内部无可见文本（去除注释与标签后只剩空白）
    const closeIdx = findClosingTagIndex(html.substring(m.index), 'div');
    const innerStart = m.index + m[0].length;
    const innerEnd = closeIdx >= 0 ? m.index + closeIdx : innerStart;
    const inner = html.substring(innerStart, innerEnd);
    const visible = inner
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!visible) count++;
  }
  return count;
}

// —— 背景明暗探测（封面艺术字分叉用）：定位承载文本的实底容器，合成其背景后定整页色调 ——
// 跳过母版层（data-master-*）与装饰层（绝对定位+无指针），避免被 hero 蒙版 / 装饰光晕误判为深底。
// 取第一个带实底（合成后非透明）的容器定 tone；都为透明则默认白底画布。
export function detectSlideBackgroundTone(html: string, primaryColor: string): 'light' | 'dark' {
  const divRe = /<div([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(html)) !== null) {
    const attrs = m[1];
    if (/data-master/i.test(attrs)) continue; // 跳过母版/hero 层
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (!styleMatch) continue;
    const style = styleMatch[1];
    if (isDecorativeLayer(style)) continue; // 装饰层不决定整页色调
    const tone = resolveBgTone(style, primaryColor);
    if (tone === 'dark') return 'dark';
    if (tone === 'light') return 'light';
    // unknown（背景透明）→ 继续看下一个实底容器
  }
  return 'light'; // 无实底 → 默认白底画布
}

// ===== 共享：alpha 感知的颜色 / 对比度工具组 =====
// 背景真实可见色 = 半透明层按 alpha 叠加到白底画布后的合成结果；8 位 hex 必须保留 alpha。
// 所有「深浅底判定 / 是否改写文字色」都收敛到这一组，避免各兜底口径打架（浅底白字根因）。

// alpha 感知的四元组解析
export function enforceCoverPosterArtStyles(
  html: string,
  primaryColor: string,
  _sw: number,
  _sh: number,
  titleColor?: string,
  composition?: ReferenceComposition,
): string {
  let result = html;
  // —— Bug-3 加固 D：即使 isCover 判定"应该是封面"，如果检测到 h2/h3/ul/ol/img/table 内容标记也直接退出
  //    （防止极端情况下 isCover 的 h1+/h2- 判定因大小写/注释等原因被绕过，而 Step1 又无条件向最外层写三件套）
  const hasH2OrList = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i.test(result);
  if (hasH2OrList) return result;
  const darker = darkenPrimaryColor(primaryColor, 0.75);
  // 判断是否封面：最外层 div 里有 <h1 且没有 <h2（cover 特征）
  const isCover = /<h1[^>]*>/i.test(result) && !/<h2[^>]*>/i.test(result);
  if (!isCover) return result;
  // FR-4 幂等守卫：已施加过封面海报艺术字（含 data-noppt-coverart 标记）则整体跳过，
  // 避免 agent 一次处理 + server 重放（postProcessHtmlSnapshot）多次调用下重复注入装饰 / badge、重复覆写字号间距。
  if (/data-noppt-coverart/i.test(result)) return result;
  // 背景明暗探测：深底（含深色渐变）封面 → 白色艺术字；浅底 → 主色渐变艺术字
  const tone = detectSlideBackgroundTone(result, primaryColor);
  const GRAD = `linear-gradient(135deg,${primaryColor},${darker})`;
  // 参考左对齐构图时，不强行给容器/H1 加居中，保留参考版式
  const center = composition !== 'left-aligned';

  // Step 1: 调整外层容器居中（找到包含 width:100%;height:100%;overflow:hidden 的 outermost flex 容器）
  if (center) {
    result = result.replace(/<div([^>]*style=")([^"]+)("[^>]*>)/gi, (_m, pre, style, post) => {
      // 必须是外层：style 里同时有 width:100%、height:100%、overflow:hidden、display:flex
      if (!(
        /width\s*:\s*100%/i.test(style) &&
        /height\s*:\s*100%/i.test(style) &&
        /overflow\s*:\s*hidden/i.test(style) &&
        /display\s*:\s*flex/i.test(style)
      ))
        return _m;
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
      props.set('justify-content', 'center');
      props.set('align-items', 'center');
      props.set('text-align', 'center');
      const newStyle = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return `<div${pre}${newStyle}${post}`;
    });
  }

  // Step 2 + 3: H1 升级为海报级超大艺术字 + 发光 + 描边
  result = result.replace(
    /<h1([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/h1>/i,
    (_m, pre, style, post, text) => {
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
      // 字号
      let fs = parseFloat(props.get('font-size') || '64');
      if (fs < 80) fs = 88;
      props.set('font-size', `${fs}px`);
      // 字重
      const fw = parseInt(props.get('font-weight') || '700', 10);
      if (fw < 900) props.set('font-weight', '900');
      props.set('line-height', '1.1');
      props.set('letter-spacing', '0.01em');
      props.set('width', '100%');
      props.set('text-align', center ? 'center' : 'left');
      props.set('max-width', center ? 'none' : '58%');
      // 深底/浅底分叉：深底（含深色渐变背景）用白色艺术字；浅底用主色渐变艺术字
      if (tone === 'dark') {
        // 深底：白色艺术字（清理渐变裁剪属性，否则红字压红底不可读），保留描边/发光
        props.set('color', '#FFFFFF');
        props.delete('background');
        props.delete('-webkit-background-clip');
        props.delete('background-clip');
        props.delete('-webkit-text-fill-color');
        props.set(
          'text-shadow',
          `0 4px 30px rgba(0,0,0,0.35),0 0 70px ${primaryColor}30,0 0 140px ${primaryColor}15`,
        );
        props.set('-webkit-text-stroke', `1.5px rgba(255,255,255,0.55)`);
      } else {
        if (titleColor) {
          // 参考标题色存在：标题色收敛——H1 强制纯色 titleColor，删除任何渐变裁剪属性，
          // 改用 text-shadow 多层光晕 + 描边实现海报级冲击力（不注入/不保留渐变填充）。
          const tColor = normalizeHex(titleColor) || titleColor;
          props.set('color', tColor);
          props.delete('background');
          props.delete('-webkit-background-clip');
          props.delete('background-clip');
          props.delete('-webkit-text-fill-color');
        } else {
          const hasGradFill =
            props.has('-webkit-text-fill-color') &&
            props.get('-webkit-text-fill-color') === 'transparent';
          if (!hasGradFill) {
            props.set('background', GRAD);
            props.set('-webkit-background-clip', 'text');
            props.set('-webkit-text-fill-color', 'transparent');
            props.set('background-clip', 'text');
          }
        }
        props.set(
          'text-shadow',
          `0 4px 30px ${primaryColor}50,0 0 70px ${primaryColor}30,0 0 140px ${primaryColor}15`,
        );
        props.set('-webkit-text-stroke', `1.5px ${primaryColor}80`);
      }
      props.delete('margin-top');
      props.set('margin-bottom', '32px');
      const ns = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return `<h1${pre}${ns}${post}${text}</h1>`;
    },
  );

  // Step 4: 如果 H1 之后没有渐变粗装饰条（<div> 6~10px 高度的渐变条），插入
  // 先看 h1 闭合后 1K 字符内有没有 "height:10px" 或 "height:8px"+"background:linear-gradient"
  const hasDecorBar =
    /<\/h1>[\s\S]{0,1000}height:\s*(?:[89]|1[0-2])px[\s\S]{0,150}background:\s*linear-gradient/i.test(
      result,
    );
  if (!hasDecorBar) {
    // H1 后面允许间隔更宽（换行+注释+空格都算）
    result = result.replace(/<\/h1>([\s\S]{0,200}?)(<(?:p|div)\b)/i, (_m, gap, nextTag) => {
      // 如果 gap 里已经有 <div（即已有装饰块）就跳过
      if (/<div/i.test(gap)) return _m;
      const bar = `</h1>${gap}<div style="width:180px;height:10px;background:linear-gradient(90deg,${primaryColor},${darker});border-radius:5px;margin:0 auto 48px auto;box-shadow:0 4px 20px ${primaryColor}45;"></div>${nextTag}`;
      return bar;
    });
  }

  // Step 5: 装饰光晕 blobs 数量 < 2 → 插入 右上 + 左下两个
  // 语义化统计：绝对定位 + 含渐变/clip-path + 内部无可见文本的纯装饰 div。
  // 关键修复：不再依赖紧凑无空格的正则字面（pointer-events:none / clip-path:polygon），
  // 因为终局 server 端 sanitizeHtmlServerSide 用 JSDOM 序列化会把 style 规范化为 "key: value"（带空格），
  // 旧正则 100% 失配 → 误判"无装饰" → 重复注入模板装饰。语义判定对空白差异鲁棒。
  const blobCount = countDecorativeBlobs(result);
  if (blobCount < 2) {
    // 外层第一个 <div ...width:100%;height:100%;overflow:hidden...> 之后插入两个装饰 div
    // 宽松匹配：style 里同时有 width:100%、height:100%、overflow:hidden
    result = result.replace(/<div([^>]*style=")([^"]+)("[^>]*>)/i, (_m, pre, style, post) => {
      if (!(
        /width\s*:\s*100%/i.test(style) &&
        /height\s*:\s*100%/i.test(style) &&
        /overflow\s*:\s*hidden/i.test(style) &&
        /display\s*:\s*flex/i.test(style)
      ))
        return _m;
      return `<div${pre}${style}${post}
<div style="position:absolute;top:-80px;right:-120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,${primaryColor}35 0%,${primaryColor}10 45%,transparent 75%);pointer-events:none;"></div>
<div style="position:absolute;left:-160px;bottom:-120px;width:480px;height:400px;background:linear-gradient(135deg,${primaryColor}18,${darker}10);clip-path:polygon(0 30%,40% 0,80% 60%,30% 100%);pointer-events:none;"></div>
<div style="position:absolute;left:80px;top:20%;bottom:20%;width:3px;background:linear-gradient(180deg,transparent,${primaryColor},transparent);border-radius:2px;pointer-events:none;"></div>`;
    });
  }

  // Step 6: 副标题分层（p 标签批量调整顺序）
  // 先收集 H1 之后、外层 </div> 之前的所有 <p ...>...</p>，按顺序处理
  const h1EndIdx = result.search(/<\/h1>/i);
  if (h1EndIdx > 0) {
    // 跳过装饰条 div，取正文 p 序列
    const afterH1 = result.slice(h1EndIdx + 5);
    const pMatches = [...afterH1.matchAll(/<p([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/p>/gi)];
    const totalPs = pMatches.length;
    if (totalPs > 0) {
      pMatches.forEach((m, idx) => {
        const full = m[0] as string;
        const pre = m[1] as string;
        const style = m[2] as string;
        const post = m[3] as string;
        const textPart = m[4] as string;
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        // === 修复 E：查找外层直接包裹容器（afterH1 里这个 p 前面最近的一个未闭合的 div）是不是 Badge 容器 ===
        // 找到 full 在 afterH1 中的绝对起始偏移
        const startInAfter = m.index ?? 0;
        // 往回看最多 400 字符，找最近一个 <div...> 且匹配到 </div> 要在 startInAfter+full.length 之后
        let parentIsBadge = false;
        const tail = afterH1.slice(Math.max(0, startInAfter - 500), startInAfter);
        // 压栈式检查：从 tail 末尾往回找所有 <div> / </div>，平衡后找到最后一个未闭合的 <div（要求匹配的 </div> 必须在 p 之后出现 且 距离 p 结束只有 whitespace）
        const tailRe = /<(\/)?div\b([^>]*)>/gi;
        const hits: Array<{ close: boolean; attrs: string; pos: number }> = [];
        let mm: RegExpExecArray | null;
        while ((mm = tailRe.exec(tail)) !== null) {
          hits.push({ close: mm[1] === '/', attrs: mm[2] || '', pos: mm.index });
        }
        let bal = 0;
        let unclosed: (typeof hits)[number] | null = null;
        for (let k = hits.length - 1; k >= 0; k--) {
          bal += hits[k].close ? -1 : +1;
          if (bal > 0 && !hits[k].close) {
            unclosed = hits[k];
            break;
          }
        }
        if (unclosed) {
          // 检查 p 之后是否立即出现外层 </div>（间隔只有空白/换行），说明这个 div 刚好包着这个 p
          const afterP = afterH1.slice(startInAfter + full.length);
          if (/^\s*<\/div>/i.test(afterP)) {
            // 用 isBadgeStyle 相同的 4 特征 3/4 判定
            const attrs = unclosed.attrs;
            const sm = attrs.match(/style="([^"]*)"/i);
            if (sm) {
              const s = sm[1];
              const has = (r: RegExp) => r.test(s);
              const score = [
                has(/display\s*:\s*(?:inline-flex|flex)\b/i),
                has(/padding\s*:[^;]*(?:1[0-9]px\s+2[0-9]px|10px\s+28px|12px\s+24px)\b/i),
                has(/border-radius\s*:[^;]*999px/i),
                has(
                  /background\s*:[^;]*(?:#[0-9a-f]{6,8}1[0-9a-f]|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.0[5-9])/i,
                ),
              ].filter(Boolean).length;
              if (score >= 3) parentIsBadge = true;
            }
          }
        }
        // 副标题分层：仅当对比度不达标时才修正颜色，保留大模型原始字号 / 字重 / 渐变艺术字（保守策略）
        const pageBg: [number, number, number] = tone === 'dark' ? [30, 30, 30] : [255, 255, 255];
        const isGradText = (p: Map<string, string>): boolean =>
          (p.get('-webkit-text-fill-color') || '').toLowerCase() === 'transparent' &&
          /text/.test(p.get('background-clip') || p.get('-webkit-background-clip') || '');
        const fixColorIfNeeded = (): void => {
          const cur = (props.get('color') || '').trim();
          if (isGradText(props)) {
            // 渐变艺术字：仅深底可能不可读 → 改纯白；浅底保留大模型渐变艺术字
            if (relativeLuminance(pageBg) < 0.18) {
              props.set('color', '#FFFFFF');
              props.delete('background');
              props.delete('-webkit-background-clip');
              props.delete('background-clip');
              props.delete('-webkit-text-fill-color');
            }
            return;
          }
          if (
            cur &&
            needsContrastFix(cur, pageBg, fontSizeOf(props), fontWeightOf(props))
          ) {
            props.set('color', tone === 'dark' ? '#FFFFFF' : '#1F2937');
          }
        };
        if (totalPs === 1) {
          fixColorIfNeeded();
        } else if (idx === 0) {
          // 第一行：不强制字号/字重；保留大模型（含渐变艺术字），仅在不达标时修正颜色
          fixColorIfNeeded();
        } else if (idx < totalPs - 1) {
          // 中间行：保留模型字号/字重；仅在不达标时修正颜色（修复 slide-01 副标题 24px/#1F2937 → 28px/#F3F4F6 的误改）
          fixColorIfNeeded();
          // 外层是 Badge：清掉 wrapTextNodes 可能带进的 DEFAULT_P_STYLE 脏值，避免和外层 badge 样式冲突
          if (parentIsBadge) {
            props.delete('padding');
            props.delete('box-shadow');
            props.delete('background');
            props.delete('border-radius');
            props.delete('letter-spacing');
            props.delete('display');
            props.delete('align-items');
            props.delete('overflow-wrap');
            props.delete('word-break');
          }
        } else {
          // 最后一行：胶囊 badge（保留容器装饰，仅保证文字对比）
          const hasDisplayBadge = /inline-flex|^flex$/i.test((props.get('display') || '').trim());
          const hasPaddingBadge = /1[0-9]px\s+2[0-9]px|^\s*10px\s+28px/.test(
            props.get('padding') || '',
          );
          const hasRadiusBadge = /999px/.test(props.get('border-radius') || '');
          const pSelfBadge = hasDisplayBadge && hasPaddingBadge && hasRadiusBadge;
          if (!parentIsBadge && !pSelfBadge) {
            props.set('display', 'inline-flex');
            props.set('align-items', 'center');
            props.set('padding', '10px 28px');
            props.set('border-radius', '999px');
            props.set(
              'background',
              tone === 'dark' ? 'rgba(255,255,255,0.14)' : `${primaryColor}12`,
            );
            props.set('letter-spacing', '0.02em');
            props.set('box-shadow', `0 2px 10px ${primaryColor}20`);
          } else {
            // 外层/自身已是 Badge：清理 DEFAULT_P_STYLE 脏值
            props.delete('overflow-wrap');
            props.delete('word-break');
            props.delete('color');
            props.delete('line-height');
            if (parentIsBadge) {
              props.delete('padding');
              props.delete('background');
              props.delete('border-radius');
              props.delete('box-shadow');
              props.delete('letter-spacing');
              props.delete('display');
              props.delete('align-items');
            }
          }
          // 文本相关属性（badge 容器背景由我们设定，颜色按对比安全设置）
          props.set('color', tone === 'dark' ? '#FFFFFF' : primaryColor);
          props.set('font-size', '20px');
          props.set('font-weight', '600');
          props.set('margin', '0');
        }
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        const replacement = `<p${pre}${ns}${post}${textPart}</p>`;
        result = result.replace(full, replacement);
      });
    }
  }
  // FR-4 幂等标记：标记已施加封面艺术字，确保后续重放（postProcessHtmlSnapshot）整体跳过，
  // 避免因 agent 一次处理 + server 多次重放导致装饰 / badge 被重复注入。
  if (!/data-noppt-coverart/i.test(result)) {
    result = result.replace(
      /<div([^>]*style=")([^"]*width:100%[^"]*height:100%[^"]*overflow:hidden[^"]*)("[^>]*>)/i,
      (_m, pre, style, post) =>
        `<div${pre}${style}${post.replace(/>$/, ' data-noppt-coverart>')}`,
    );
  }
  return result;
}

/**
 * 建议2：左文右图 55:45 + 文字 li 卡片条化
 * 判定：外层有 flex:1 两列，一列 ul 文字，一列 img（content-image-right/left）
 * 措施：
 *   1. 图片列 45% 文字列 55%（无论 left/right 文字都 > 图片）
 *   2. 每个 li 增加 padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,P08,P10);
 *      border-left:5px solid P; box-shadow:0 4px 16px P15;
 *   3. li 里的图标 span width:28 → 40px，height:40
 *   4. 文字 span font-size:22 → 28px, font-weight:600, color:#111827
 *   5. 文字列 justify-content: space-evenly
 */
export function enforceLeftRight5545AndCardBar(html: string, primaryColor: string): string {
  let result = html;
  // 判定：不是对比页（没有 content-compare）：有 > div style="flex:0 0 45%" 里是 img
  const hasFlexSplit = /flex:\s*0\s+0\s+45%/i.test(result) && /<img[\s>]/i.test(result);
  const hasCompareGrid =
    /border:\s*2px\s+solid\s+(?:#E5E7EB|[^";]*{[^}]*})/i.test(result) &&
    /background:\s*#[0-9A-Fa-f]{6}08/i.test(result);
  if (!hasFlexSplit || hasCompareGrid) return result;
  const darker = darkenPrimaryColor(primaryColor, 0.78);
  const CARD_BG = `linear-gradient(135deg,${primaryColor}08,${primaryColor}10)`;
  const CARD_SHADOW = `0 4px 16px ${primaryColor}15`;

  // 1. 比例修正（防双重嵌套）：
  //    - 判定：横排父容器（display:flex 且无 flex-direction:column，且子节点同时含 55%/45% 两列或 ul+img）→ 设为 flex:1 1 0%（占满 H2 下方剩余宽度）
  //    - 文字列 div（display:flex flex-direction:column 且包 ul）→ 设为 flex:0 0 55%
  //    - 图片列 div（包 img）→ 设为 flex:0 0 45%
  // 修复 A1/A2/B2：精确扫描直接子节点（避免孙节点干扰）、保护已有正确 flex 值不被覆盖、移除多余标签前缀
  const splitRegex = /(<div[^>]*style=")([^"]*)("[^>]*>)/gi;
  // 关键：用 replace 回调的 offset（第 5 个参数）精准定位当前匹配位置，避免 indexOf 命中相同字符串的旧位置
  result = result.replace(
    splitRegex,
    (_m: string, pre: string, style: string, post: string, offset: number, _src: string) => {
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
      const display = (props.get('display') || '').trim();
      const flexDir = (props.get('flex-direction') || '').trim();
      if (display !== 'flex') return _m;

      // —— T5-FR5 防误伤：跳过「1280×720 画布根容器」——
      // 根容器特征（缺一不可）：width:100% + height:100%，且没有明确的百分比 flex-basis（0 0 55% / 0 0 45%）。
      // 把根容器当「文字列」改 flex:0 0 55% 会把图片列挤出可见区域（整页只剩 55% 宽）。
      const w = (props.get('width') || '').trim();
      const h = (props.get('height') || '').trim();
      const curFlex = (props.get('flex') || '').trim();
      const isCanvasRoot = w === '100%' && h === '100%' && !/0\s+0\s+(?:\d+)%/.test(curFlex);
      if (isCanvasRoot) return _m;

      // —— B2：使用栈式精确扫描直接子节点，不包含孙节点 ——
      const contentStart = offset + _m.length;
      const closeIdx = findClosingTagIndex(result.substring(offset), 'div');
      const containerInner =
        closeIdx >= 0
          ? result.substring(contentStart, offset + closeIdx)
          : result.substring(contentStart, contentStart + 8000);
      const directChildren = findDirectChildElements(containerInner);

      const childFlexes = directChildren
        .filter((c) => c.tagName === 'div' && c.styleAttr)
        .slice(0, 10)
        .map((c) => {
          const childProps = new Map<string, string>();
          for (const d of parseStyleDeclarations(c.styleAttr!)) childProps.set(d.key, d.value);
          return {
            flex: childProps.get('flex') || '',
            childDir: childProps.get('flex-direction') || '',
          };
        });
      const hasChildUl =
        directChildren.some((c) => c.tagName === 'ul' || c.tagName === 'ol') ||
        directChildren.some(
          (c) => c.tagName === 'div' && /<(ul|ol)[\s>]/i.test(c.innerPreview || ''),
        );
      const hasChildImg =
        directChildren.some((c) => c.tagName === 'img' || c.tagName === 'picture') ||
        directChildren.some(
          (c) => c.tagName === 'div' && /<(img|picture)[\s>]/i.test(c.innerPreview || ''),
        );
      const hasChild55 = childFlexes.some(
        (c) => /0\s+0\s+55%/.test(c.flex) || c.childDir === 'column',
      );
      const hasChild45 = childFlexes.some((c) => /0\s+0\s+45%/.test(c.flex));

      // —— 不变量校验（pres_mtzke4lj_ovu6r61 复盘）——
      // 正文容器若被挤出列（横排 wrapper 出现「45% 图列 + 55% 文列 + 游离 ul 列」三个子项），
      // 继续强制 45/55 会把游离列压成 0 宽 → 整页文字不可见。
      // 检测到异常分栏时直接跳过本次纠偏（保守优先于"看起来更像左右分栏"）。
      const flexPercentSum = childFlexes.reduce((sum, c) => {
        const m = c.flex.match(/0\s+0\s+(\d+)%/);
        return sum + (m ? Number(m[1]) : 0);
      }, 0);
      const ulColumnCount = directChildren.filter(
        (c) => c.tagName === 'div' && /<(ul|ol)[\s>]/i.test(c.innerPreview || ''),
      ).length;
      if (flexPercentSum > 100 || ulColumnCount >= 2) {
        console.warn(
          `[${formatBeijingTime()}] [AGENT] enforceLeftRight5545AndCardBar: 分栏结构异常（固定列合计=${flexPercentSum}%，含列表的列=${ulColumnCount}），跳过 45/55 纠偏以避免文字被压成 0 宽`,
        );
        return _m;
      }

      // ========== 外层横排父容器（左右两列布局的 wrapper）→ flex:1 1 0% 占满 H2 下方剩余宽度 ==========
      const isRowWrapper =
        (!flexDir || flexDir === 'row') &&
        ((hasChildUl && hasChildImg) || (hasChild55 && hasChild45));
      if (isRowWrapper) {
        // A2：若已经存在合理 flex 值（1 / 1 1 0% / 1 1 auto）则不覆盖
        const curFlex = (props.get('flex') || '').trim();
        const flexAlreadyOk = /^(1|flex|auto)\b/.test(curFlex) || /^1\s+1\s+/.test(curFlex);
        if (!flexAlreadyOk) props.set('flex', '1 1 0%');
        if (!props.has('min-height')) props.set('min-height', '0');
        if (!props.has('min-width')) props.set('min-width', '0');
        if (!props.has('gap')) props.set('gap', '40px');
        if (!props.has('align-items')) props.set('align-items', 'stretch');
        props.delete('overflow');
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `${pre}${ns}${post}`; // A1 修复：pre 已含 <div，不再重复拼
      }

      // ========== 文字列（column 且包 ul，内部无大 img 列）→ flex:0 0 55% ==========
      if (flexDir === 'column' && hasChildUl && !hasChildImg && !hasChild45) {
        // A2：已有 0 0 55% 则不覆盖；若 flex 非空但不符合目标也不强制（保留 AI 原值）
        const curFlex = (props.get('flex') || '').trim();
        if (!curFlex || /0\s+0\s+55%/.test(curFlex)) {
          props.set('flex', '0 0 55%');
        }
        if (!props.has('min-height')) props.set('min-height', '0');
        if (!props.has('min-width')) props.set('min-width', '0');
        props.delete('overflow');
        if (!props.has('justify-content')) props.set('justify-content', 'space-evenly');
        if (!props.has('align-items')) props.set('align-items', 'stretch');
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `${pre}${ns}${post}`; // A1 修复
      }

      // ========== 图片列（包含 <img 或 picture）→ flex:0 0 45% ==========
      if ((!flexDir || flexDir === 'row') && hasChildImg && !hasChildUl && !hasChild55) {
        // A2：已有 0 0 45% 则不覆盖
        const curFlex = (props.get('flex') || '').trim();
        if (!curFlex || /0\s+0\s+45%/.test(curFlex)) {
          props.set('flex', '0 0 45%');
        }
        if (!props.has('min-height')) props.set('min-height', '0');
        if (!props.has('min-width')) props.set('min-width', '0');
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `${pre}${ns}${post}`; // A1 修复
      }

      return _m;
    },
  );

  // 2. 兜底清除：所有 <ul> 上被编辑器附加的固定 height/width/max-height/max-width（会导致最后一行被裁剪）
  // A3：父列已有正确比例（0 0 55%）下的 ul、或当前 ul 的 flex 已正确时，仅删坏属性不设 flex:1 1 auto
  result = result.replace(
    /(<ul[^>]*style=")([^"]*)("[^>]*>)/gi,
    (_m: string, pre: string, style: string, post: string) => {
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
      props.delete('height');
      props.delete('width');
      props.delete('max-height');
      props.delete('max-width');
      props.delete('left');
      props.delete('top');
      props.delete('position');
      props.delete('transform');
      if (!props.has('min-height')) props.set('min-height', '0');
      // A3：仅当 flex 为空或明显无效（纯数字无单位的异常值）时才设为 1 1 auto
      const curFlex = (props.get('flex') || '').trim();
      if (!curFlex) {
        props.set('flex', '1 1 auto');
      }
      const ns = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return `${pre}${ns}${post}`; // A1 修复：pre 已含 <ul
    },
  );

  // 2~4. 把每个 li 变成卡片条（非对比页，li 里有图标+文字 span 对）
  // B3：所有属性缺失时才补默认值，已有值保留不覆盖
  const liPattern =
    /<li([^>]*style=")([^"]*)("[^>]*>\s*)(<span[^>]*style="[^"]*display\s*:\s*inline-flex[^"]*"[^>]*>[\s\S]*?<\/span>)\s*(<span[^>]*style=")([^"]*)("[^>]*>[\s\S]*?<\/span>\s*<\/li>)/gi;
  let safety = 0;
  while (safety++ < 8) {
    const before = result;
    result = result.replace(
      liPattern,
      (_m, liPre, liStyle, liMid, iconSpan, txtPre, txtStyle, txtRest) => {
        // 升级 li 样式：卡片条（B3：已有值优先，缺失才补默认）
        const liProps = new Map<string, string>();
        for (const d of parseStyleDeclarations(liStyle)) liProps.set(d.key, d.value);
        if (!liProps.has('padding')) liProps.set('padding', '20px 24px');
        if (!liProps.has('border-radius')) liProps.set('border-radius', '14px');
        if (!liProps.has('background')) liProps.set('background', CARD_BG);
        if (!liProps.has('border-left')) liProps.set('border-left', `5px solid ${primaryColor}`);
        if (!liProps.has('box-shadow')) liProps.set('box-shadow', CARD_SHADOW);
        if (!liProps.has('gap')) liProps.set('gap', '18px');
        if (!liProps.has('min-width')) liProps.set('min-width', '0');
        const liNew = Array.from(liProps.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');

        // 升级图标 span：28 → 40px（B3：只有值偏小才升级，background / box-shadow 仅缺失才补）
        let newIconSpan = iconSpan.replace(/style="([^"]*)"/i, (_sm: string, is: string) => {
          const ip = new Map<string, string>();
          for (const d of parseStyleDeclarations(is)) ip.set(d.key, d.value);
          let w = parseFloat(ip.get('width') || '0');
          let h = parseFloat(ip.get('height') || '0');
          if (!w || w < 36) ip.set('width', '40px');
          if (!h || h < 36) ip.set('height', '40px');
          if (!ip.has('background'))
            ip.set('background', `linear-gradient(135deg,${primaryColor},${darker})`);
          if (!ip.has('box-shadow')) ip.set('box-shadow', `0 2px 8px ${primaryColor}40`);
          const ni = Array.from(ip.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
          return `style="${ni}"`;
        });
        // 升级 svg 宽高 15→22px（如果在 20 以下）
        newIconSpan = newIconSpan.replace(
          /svg\s+width="(\d+)"\s+height="(\d+)"/gi,
          (_svm: string, w: string, h: string) => {
            const nw = parseInt(w, 10) < 20 ? 22 : parseInt(w, 10);
            const nh = parseInt(h, 10) < 20 ? 22 : parseInt(h, 10);
            return `svg width="${nw}" height="${nh}"`;
          },
        );

        // 升级文字 span（B3：已有值优先）
        const txtProps = new Map<string, string>();
        for (const d of parseStyleDeclarations(txtStyle)) txtProps.set(d.key, d.value);
        const fs = parseFloat(txtProps.get('font-size') || '0');
        if (!fs || fs < 26) txtProps.set('font-size', '28px');
        if (!txtProps.has('font-weight')) txtProps.set('font-weight', '600');
        if (!txtProps.has('color')) txtProps.set('color', '#111827');
        if (!txtProps.has('line-height')) txtProps.set('line-height', '1.4');
        if (!txtProps.has('flex')) txtProps.set('flex', '1');
        if (!txtProps.has('min-width')) txtProps.set('min-width', '0');
        const txtNew = Array.from(txtProps.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');

        // —— 捕获组复核（FIX-1：2026-08-03 灾难修复）——
        // liPattern = /<li([^>]*style=")([^"]*)("[^>]*>\s*)(<span...inline-flex...>...<\/span>)\s*(<span[^>]*style=")([^"]*)("[^>]*>...<\/span>\s*<\/li>)/
        // 组 1(liPre)   = [^>]*style="     → 例： style=" 或  data-x="y" style="  —— ⚠️不含字面量 <li
        // 组 2(liStyle) = style 内部值
        // 组 3(liMid)   = "[^>]*>\s*       → 例：">
        // 组 4(iconSpan)= 图标 span 全段（含 <span 开标签）
        // 组 5(txtPre)  = <span[^>]*style=" → ⚠️这里又含 <span（字面量在括号里）
        // 组 6(txtStyle)= 文字 span style 值
        // 组 7(txtRest) = "[^>]*>...<\/span>\s*<\/li>
        return `<li${liPre}${liNew}${liMid}${newIconSpan}${txtPre}${txtNew}${txtRest}`;
      },
    );
    if (result === before) break;
  }

  // 5. 文字列容器 justify-content: center → space-evenly
  result = result.replace(
    /(<div[^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*min-width\s*:\s*0[^"]*overflow\s*:\s*hidden[^"]*)justify-content\s*:\s*center([^"]*"[^>]*>[\s\S]{0,200}?<ul)/gi,
    (_m, pre, post) => `${pre}justify-content:space-evenly${post}`,
  );

  // 额外：ul gap: 16 → 24
  result = result.replace(
    /(<ul[^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*)gap\s*:\s*16px([^"]*")/gi,
    (_m, pre, post) => `${pre}gap:24px${post}`,
  );

  // ===== 新增：卡片条化后自适应压缩，防最后一行裁剪
  // 统计 <li 数量 ≥4 时略微收紧 li padding 和 ul gap
  // 统计 <li 数量 ≥5 时再缩 li 字号 28→25、图标 40→36
  const countMatches = result.match(/<li\s[^>]*style="[^"]*padding\s*:\s*20px\s+24px/gi);
  const liCount = countMatches ? countMatches.length : 0;
  if (liCount >= 4) {
    // padding: 20px 24px → 16px 20px
    result = result.replace(/<li([^>]*style="[^"]*)padding\s*:\s*20px\s+24px\s*;?/gi, (_m, pre) =>
      `${_m.startsWith('<li') ? `<li${pre}padding:16px 20px;` : `${pre}padding:16px 20px;`}`.replace(
        /padding:16px 20px;{2,}/g,
        'padding:16px 20px;',
      ),
    );
    // 修正：直接替换 style 里的 padding 值
    result = result.replace(
      /(<li[^>]*style=")([^"]*?padding\s*:\s*)20px\s+24px\s*;?([^"]*"[^>]*>)/gi,
      (_m, pre, padPre, padPost: string) => `${pre}${padPre}16px 20px;${padPost}`,
    );
    // ul gap 24 → 20
    result = result.replace(
      /(<ul[^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*)gap\s*:\s*24px\s*;?([^"]*")/gi,
      (_m, pre, post) => `${pre}gap:20px;${post}`.replace(/gap:20px;{2,}/g, 'gap:20px;'),
    );
  }
  if (liCount >= 5) {
    // li 文字字号 28 → 25
    result = result.replace(
      /(<li[^>]*>[\s\S]{0,400}?<span[^>]*style=")([^"]*?)font-size\s*:\s*28px\s*;?([^"]*"[^>]*>)/gi,
      (_m, pre, _szPre, szPost: string) => `${pre}${_szPre}font-size:25px;${szPost}`,
    );
    // 图标 40 → 36
    result = result.replace(
      /(<li[^>]*>[\s\S]{0,200}?<span[^>]*style=")([^"]*?)width\s*:\s*40px\s*;\s*height\s*:\s*40px\s*;?([^"]*"[^>]*>)/gi,
      (_m, pre, _szPre, szPost: string) => `${pre}${_szPre}width:36px;height:36px;${szPost}`,
    );
  }
  return result;
}

/**
 * 建议3：卡片网格页文字/图标比例修正
 * 判定：grid-template-columns:repeat(2或3,1fr) + 4-6 个圆标+h3+p 结构卡片
 * 措施：
 *   1. 圆标 56 → 48px，字号 24→22
 *   2. H3 22→32px，700→800，加渐变文字
 *   3. p 18→24px，400→500，line-height 1.8→1.6
 *   4. padding 32→36
 */
export function enforceCardTextProportion(html: string): string {
  let result = html;
  const hasCardGrid = /grid-template-columns:\s*repeat\(\s*(?:2|3)\s*,\s*1fr\s*\)/i.test(result);
  if (!hasCardGrid) return result;
  const GRAD_TEXT_ANY =
    'background:linear-gradient(135deg,#7c3aed,#5b21b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';

  // 1. 圆标：56x56 → 48x48，字号 24→22
  result = result.replace(
    /<span([^>]*style="[^"]*width\s*:\s*)56px([^"]*height\s*:\s*)56px([^"]*font-size\s*:\s*)24px([^"]*)"/gi,
    (_m, pre, p2, p3, p4) => `<span${pre}48px${p2}48px${p3}22px${p4}"`,
  );

  // 2. H3：22→32，700→800，color 主色改渐变
  result = result.replace(
    /<h3([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/h3>/gi,
    (_m, pre, style, post, txt) => {
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
      const fs = parseFloat(props.get('font-size') || '22');
      if (fs < 28) props.set('font-size', '32px');
      const fw = parseInt(props.get('font-weight') || '700', 10);
      if (fw < 800) props.set('font-weight', '800');
      props.set('line-height', '1.35');
      // 如有明确的 color:主色 或者没有渐变 fill → 替换成渐变 fill 文字
      const hasGradFill = props.get('-webkit-text-fill-color') === 'transparent';
      const curColor = props.get('color');
      if (!hasGradFill && curColor) {
        // 解析颜色构建渐变
        const cleanCol = curColor.trim();
        const darker = /^#[0-9A-Fa-f]{6}$/.test(cleanCol)
          ? darkenPrimaryColor(cleanCol, 0.75)
          : darkenPrimaryColor('#7c3aed', 0.75);
        const base = /^#[0-9A-Fa-f]{6}$/.test(cleanCol) ? cleanCol : '#7c3aed';
        props.set('background', `linear-gradient(135deg,${base},${darker})`);
        props.set('-webkit-background-clip', 'text');
        props.set('-webkit-text-fill-color', 'transparent');
        props.set('background-clip', 'text');
        props.delete('color');
      } else if (!hasGradFill && !curColor) {
        // 默认紫渐变
        result.replace(GRAD_TEXT_ANY, () => '');
        props.set('background', 'linear-gradient(135deg,#7c3aed,#5b21b6)');
        props.set('-webkit-background-clip', 'text');
        props.set('-webkit-text-fill-color', 'transparent');
        props.set('background-clip', 'text');
      }
      const ns = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return `<h3${pre}${ns}${post}${txt}</h3>`;
    },
  );

  // 3. p 18→24，400→500，1.8→1.6
  result = result.replace(
    /<p([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/p>/gi,
    (_m, pre, style, post, txt) => {
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
      const fs = parseFloat(props.get('font-size') || '18');
      if (fs < 22) props.set('font-size', '24px');
      const fw = parseInt(props.get('font-weight') || '400', 10);
      if (fw < 500) props.set('font-weight', '500');
      const lh = parseFloat(props.get('line-height') || '1.8');
      if (lh >= 1.8 || Number.isNaN(lh)) props.set('line-height', '1.6');
      // color #6B7280 → #374151（更深点）
      if (props.get('color')?.toLowerCase() === '#6b7280') props.set('color', '#374151');
      const ns = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return `<p${pre}${ns}${post}${txt}</p>`;
    },
  );

  // 4. 卡片 padding:32px → 36px
  result = result.replace(
    /(<div[^>]*style="[^"]*padding\s*:\s*)32px([^"]*border-radius\s*:\s*16px[^"]*grid|grid-template[^"]*padding\s*:\s*)32px/gi,
    (_m, pre, rest) => `${pre}36px${rest}`,
  );
  // 再次：对卡片容器 padding:32 → 36（用更宽松正则）
  result = result.replace(
    /(<div[^>]*style="[^"]*background\s*:\s*#F9FAFB[^"]*border-radius\s*:\s*16px[^"]*)padding\s*:\s*32px([^"]*")/gi,
    (_m, pre, post) => `${pre}padding:36px${post}`,
  );
  // 卡片 gap:16 → 20
  result = result.replace(
    /(<div[^>]*style="[^"]*background\s*:\s*#F9FAFB[^"]*)gap\s*:\s*16px([^"]*")/gi,
    (_m, pre, post) => `${pre}gap:20px${post}`,
  );
  return result;
}

