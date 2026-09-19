/**
 * PostProcess 簇A：文字对比度兜底（从 html-presentation-agent.ts 外置）。
 * 依赖：
 *   - 颜色工具来自 ./color（resolveBgTone / normalizeHex / darkenPrimaryColor /
 *     resolveEffectiveBgRgb / relativeLuminance / needsContrastFix / fontSizeOf / fontWeightOf）
 *   - 样式解析来自 @noppt/core（parseStyleDeclarations / isEffectiveClipText）
 */
import { parseStyleDeclarations, isEffectiveClipText } from '@noppt/core';
import type { SlideColorPolicy } from '../../../types';
import {
  resolveBgTone,
  normalizeHex,
  darkenPrimaryColor,
  resolveEffectiveBgRgb,
  relativeLuminance,
  needsContrastFix,
  fontSizeOf,
  fontWeightOf,
} from './color';

// =========================================================================
// 缺陷 2 兜底：深色/主色背景区块 → 文字强制改为白色（对比度修复）
// 识别 div 的 background / background-color 是否包含主色或其 darker 变体
// 然后对该 div 范围内所有文本标签（h1-h6/p/li/span 等）设置 color:#FFFFFF
// =========================================================================
export function enforceDarkBgTextContrast(
  html: string,
  primaryColor: string,
  colorPolicy?: SlideColorPolicy,
): string {
  // 统一口径：深底判定收敛到共享权威 resolveBgTone（alpha 感知 + 渐变合成），消除与终局兜底口径打架
  const isDarkBackgroundStyle = (style: string): boolean => {
    return resolveBgTone(style, primaryColor) === 'dark';
  };

  // 递归处理嵌套标签：外层 li 处理完 → 再递归进入它的 inner 处理 span/strong 等内层
  const processTag = (seg: string, depth: number): string => {
    if (depth > 5) return seg; // 防止无限递归
    return seg.replace(
      /<(h[1-6]|p|li|span|small|a|strong|em|b|i|u|label)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
      (tagMatch, tag: string, attrs: string | undefined, _inner: string) => {
        // 如果是图标容器（inline-flex + flex-shrink:0 + 宽高 + border-radius），不修改（SVG/数字本来就是白色）
        if (attrs && /style="[^"]*"/i.test(attrs)) {
          const styleM = attrs.match(/style="([^"]*)"/i);
          if (styleM) {
            const st = styleM[1];
            const hasInlineFlex = /display\s*:\s*inline-flex/i.test(st);
            const hasFlexShrink = /flex-shrink\s*:\s*0/i.test(st);
            const hasSize = /width\s*:\s*\d+px/i.test(st) && /height\s*:\s*\d+px/i.test(st);
            if (hasInlineFlex && hasFlexShrink && hasSize) {
              return tagMatch; // 图标容器跳过（已经白色）
            }
          }
        }
        // 先递归处理内层（让内层 span/strong 先被变白，避免外层包裹内层无法触达）
        const processedInner = processTag(_inner, depth + 1);
        // 再处理/追加 style 里的 color:#FFFFFF
        let newAttrs = attrs || '';
        const styleMatch = newAttrs.match(/style="([^"]*)"/i);
        let styleStr = styleMatch ? styleMatch[1] : '';
        const styles: Record<string, string> = {};
        if (styleStr) {
          for (const { key, value } of parseStyleDeclarations(styleStr)) {
            styles[key] = value;
          }
        }
        // 判断：是否为「有效」渐变文字（按声明顺序，background 简写不覆盖 clip，否则不算渐变文字）
        // 渐变文字本身自带清晰的颜色，不需要强制覆盖，更不能破坏其渐变结构
        const isGradientText = isEffectiveClipText(styleStr);
        if (!isGradientText) {
          // 参考撞色 / 标题色 / 正文色 / 描边色：用户明确上传的风格，深底也不强行改成白色（保真）
          const existingColor = (styles['color'] || '').trim();
          const existingHex = existingColor ? normalizeHex(existingColor) : '';
          const isReferenceColor =
            existingHex &&
            (() => {
              for (const c of [
                colorPolicy?.titleColor,
                colorPolicy?.bodyColor,
                colorPolicy?.strokeColor,
                ...(colorPolicy?.accents || []),
              ]) {
                if (c && (normalizeHex(c) || c.toLowerCase()) === existingHex) return true;
              }
              return false;
            })();
          if (!isReferenceColor) {
            // 非渐变文字：强制白色；如果有残留的渐变裁剪属性，清理掉（避免渐变背景当背景块用）
            delete styles['background-clip'];
            delete styles['-webkit-background-clip'];
            delete styles['-webkit-text-fill-color'];
            styles['color'] = '#FFFFFF';
          }
        }
        const newStyle = Object.entries(styles)
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        if (styleMatch) {
          newAttrs = newAttrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
        } else {
          newAttrs = newAttrs ? `${newAttrs} style="${newStyle}"` : ` style="${newStyle}"`;
        }
        return `<${tag}${newAttrs}>${processedInner}</${tag}>`;
      },
    );
  };
  const makeWhiteInSegment = (segment: string): string => processTag(segment, 0);

  // 找到 div 的配对（简单版：按 stack 匹配），对背景为深色的 div 内部文字变白
  let result = html;
  const stack: Array<{ startIdx: number; endOpen: number }> = [];
  const darkRanges: Array<{ start: number; end: number }> = [];
  const divRegex = /<\/?div(\s[^>]*)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = divRegex.exec(result)) !== null) {
    const tag = m[0];
    if (/^<div/i.test(tag)) {
      stack.push({ startIdx: m.index, endOpen: m.index + tag.length });
    } else if (/^<\/div>/i.test(tag)) {
      const open = stack.pop();
      if (!open) continue;
      // 取 open tag 的 style 判断是否深色背景
      const openTagStr = result.substring(open.startIdx, open.endOpen);
      const styleM = openTagStr.match(/style="([^"]*)"/i);
      if (styleM && isDarkBackgroundStyle(styleM[1])) {
        darkRanges.push({ start: open.endOpen, end: m.index });
      }
    }
  }
  if (darkRanges.length === 0) return result;

  // 按范围从后往前修改（避免索引偏移）
  darkRanges.sort((a, b) => b.start - a.start);
  for (const r of darkRanges) {
    const sub = result.substring(r.start, r.end);
    const newSub = makeWhiteInSegment(sub);
    result = result.substring(0, r.start) + newSub + result.substring(r.end);
  }
  return result;
}

/**
 * 建议4 C步：浅底/极浅主色容器 → 禁用白色字（严重对比度问题）
 * 判定：容器 background 为：
 *   - #FFFFFF / #F9FAFB / F3F4F6 / E5E7EB 等浅色
 *   - PRIMARY_COLOR + alpha 末位 ≤ 20（xx08 / xx10 / xx14 / xx20 等极浅透明色）
 *   - 整体亮度 ≥ 0.72
 * 措施：容器内 H1-H6 / p / li / span / div 直接文本 中所有 color:#FFFFFF / F9FAFB / F3F4F6
 *       强制改为 PRIMARY_COLOR_DARKER（深主色或更深 #111827）
 */
export function enforceLightBgTextContrast(
  html: string,
  primaryColor: string,
  _colorPolicy?: SlideColorPolicy,
): string {
  const darker = darkenPrimaryColor(primaryColor, 0.72);
  let result = html;
  // 扫描叶子 div（不含子 div 的容器卡片）background 为浅底的区块
  const cardPattern = /<div([^>]*style="[^"]*"[^>]*)>((?!<div[\s>])[\s\S]*?)<\/div>/gi;
  let safety = 0;
  while (safety++ < 20) {
    const before = result;
    result = result.replace(cardPattern, (_match, attrs: string, inner: string) => {
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) return _match;
      const style = styleMatch[1];
      // 统一口径：浅底判定收敛到共享权威 resolveBgTone（alpha 感知 + 渐变合成）
      const isLight = resolveBgTone(style, primaryColor) === 'light';
      if (!isLight) return _match;
      // 对 inner 里每个文本标签(h1-h6/p/li/span/div直接文本) color 白 → 替换为深主色或 #111827
      const lightColorPattern =
        /color\s*:\s*(#(?:FFFFFF|ffffff|F9FAFB|f9fafb|F3F4F6|f3f4f6|E5E7EB|e5e7eb|FEFEFE|fefefe)\b|white\b|rgba?\(\s*25[0-5]\s*,\s*25[0-5]\s*,\s*25[0-5])/gi;
      const tagsPattern = /<(h[1-6]|p|li|span|div)([^>]*style="[^"]*"[^>]*)>/gi;
      let processedInner = inner;
      // 需要先处理 li 级的 color（li 的 style 里的白）
      processedInner = processedInner.replace(tagsPattern, (_tm, tag: string, tAttrs: string) => {
        const newAttrs = tAttrs.replace(/style="([^"]*)"/i, (_s2, s: string) => {
          if (!lightColorPattern.test(s)) return `style="${s}"`;
          // 渐变文字保护：有效渐变文字（按声明顺序，background 简写不覆盖 clip）不改 color
          if (isEffectiveClipText(s)) return `style="${s}"`;
          // 把浅色的 color 声明替换为深主色，或保留原非浅色声明
          const newStyle = s.replace(lightColorPattern, (_cm) => {
            return `color:${darker}`;
          });
          return `style="${newStyle}"`;
        });
        return `<${tag}${newAttrs}>`;
      });
      // 再检查 span 等嵌套的 style 里的白字（递归最多 3 层避免大正则问题）
      for (let i = 0; i < 2; i++) {
        const before2 = processedInner;
        processedInner = processedInner.replace(
          /(<span[^>]*style=")([^"]+)("[^>]*>)/gi,
          (_m, pre, s, post) => {
            if (!lightColorPattern.test(s)) return _m;
            // 渐变文字保护：有效渐变文字不改 color
            if (isEffectiveClipText(s)) return _m;
            const newStyle = s.replace(lightColorPattern, (_cm: string) => `color:${darker}`);
            return `${pre}${newStyle}${post}`;
          },
        );
        if (processedInner === before2) break;
      }
      return `<div${attrs}>${processedInner}</div>`;
    });
    if (result === before) break;
  }
  return result;
}

/**
 * Bug-4 FR-8 颜色兜底（双防线中的代码级层，与 Prompt 修复配合）
 * 行为：只升不降——永远把浅底下 heading 的错误中性色"升"为主色；深底下"升"为白；
 * LLM 已写对（主色/深色变体/渐变字）一律不破坏。
 * @param html 输入幻灯片 HTML（完整外层容器）
 * @param opts.primaryColor 当前页主色 hex（#7c3aed 6 位标准格式）
 * @param opts.primaryColorDarker 当前页主色深色变体 hex（#632ebe）
 * @param opts.pageBgLight 调用方显式传 true 时跳过背景推断，直接按浅底处理（可选）
 * @param opts.pageBgDark 调用方显式传 true 时跳过背景推断，直接按深底处理（可选，优先级高于 pageBgLight）
 */
export function enforceHeadingColorOnLightBg(
  html: string,
  opts: {
    primaryColor: string;
    primaryColorDarker: string;
    titleColor?: string;
    pageBgLight?: boolean;
    pageBgDark?: boolean;
  },
): string {
  if (!html) return html;
  const { primaryColor, primaryColorDarker, titleColor } = opts;
  const pLow = (primaryColor || '').toLowerCase();
  const tLow = (titleColor || '').toLowerCase();
  const dLow = (primaryColorDarker || '').toLowerCase();
  if (!/^#[0-9a-f]{6}$/i.test(pLow) && !/^#[0-9a-f]{6}$/i.test(tLow)) return html; // 主色与参考标题色均非法，不兜底

  // =================== 子工具函数 ===================
  const LIGHT_BG_HEX = new Set([
    '#fff',
    '#ffffff',
    '#f9fafb',
    '#f3f4f6',
    '#f8fafc',
    '#f1f5f9',
    '#e5e7eb',
    '#d1d5db',
  ]);
  const DARK_NEUTRAL_HEX = new Set([
    '#111827',
    '#1f2937',
    '#374151',
    '#4b5563',
    '#6b7280',
    '#9ca3af',
    '#000',
    '#000000',
  ]);
  const WHITE_HEX = new Set(['#ffffff', '#fff', '#f9fafb', '#f3f4f6']);

  /** 规范化 hex：#RGB → #RRGGBB；#RRGGBBAA → #RRGGBB；非 #xxx 形式返回原字符串 */
  const normHex = (h: string): string => {
    let s = (h || '').trim().toLowerCase();
    if (!s.startsWith('#')) return s;
    s = s.replace(/^#/, '');
    if (s.length === 3) s = `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
    if (s.length === 8) s = s.substring(0, 6);
    return '#' + s;
  };

  /** 判断某透明度位（末尾两位 hex alpha）是否 ≤20%（即 00~33；20%=51/255≈0x33） */
  const alphaLowEnough = (hexTail: string): boolean => {
    if (!hexTail || hexTail.length !== 2) return true;
    try {
      return parseInt(hexTail, 16) <= 0x33;
    } catch {
      return true;
    }
  };

  /** 从最外层 <div style="..."> 提取 background-color / background 值，判断浅或深 */
  const detectSlideBg = (): 'light' | 'dark' | 'unknown' => {
    if (opts.pageBgDark) return 'dark';
    if (opts.pageBgLight) return 'light';
    const outer = html.match(/^<div([^>]*)>/i);
    if (!outer) return 'unknown';
    const styleMatch = outer[1].match(/style="([^"]*)"/i);
    if (!styleMatch) return 'light'; // 无 style 默认白底=浅
    const styleStr = styleMatch[1];
    // 从 styleStr 提取 background-color 与 background（不依赖 parseStyleDeclarations，避免字体引号问题）
    const decls: string[] = [];
    let inQ: 0 | 1 | 2 = 0;
    let paren = 0;
    let buf = '';
    for (let i = 0; i < styleStr.length; i++) {
      const c = styleStr[i];
      if (paren === 0) {
        if (c === "'" && inQ !== 2) inQ = inQ === 1 ? 0 : 1;
        else if (c === '"' && inQ !== 1) inQ = inQ === 2 ? 0 : 2;
      }
      if (inQ === 0) {
        if (c === '(') paren++;
        else if (c === ')') paren--;
        else if (c === ';' && paren === 0) {
          decls.push(buf);
          buf = '';
          continue;
        }
      }
      buf += c;
    }
    if (buf.trim()) decls.push(buf);
    let bgColorVal = '';
    let bgVal = '';
    for (const d of decls) {
      const colonIdx = d.indexOf(':');
      if (colonIdx < 0) continue;
      const k = d.substring(0, colonIdx).trim().toLowerCase();
      const v = d.substring(colonIdx + 1).trim();
      if (k === 'background-color') bgColorVal = v.toLowerCase();
      else if (k === 'background') bgVal = v.toLowerCase();
    }
    const probe = bgColorVal || bgVal;
    if (!probe) return 'light'; // 无背景默认白=浅
    // 检查纯色 hex
    const hexM = probe.match(/^#(?:[0-9a-f]{3,8})/i);
    if (hexM) {
      const full = normHex(hexM[0]);
      // 带 alpha 的主色变体：#RRGGBBAA
      const raw = hexM[0].substring(1);
      if (raw.length === 8) {
        const colorPart = '#' + raw.substring(0, 6).toLowerCase();
        const alphaPart = raw.substring(6, 8).toLowerCase();
        // 如果颜色部分 == 主色 或 == 主色 darker，且 alpha ≤ 20% → 浅（视觉几乎白）
        if ((colorPart === pLow || colorPart === dLow) && alphaLowEnough(alphaPart))
          return 'light';
        // 其他深透明色=判 unknown 保守
        return 'unknown';
      }
      if (LIGHT_BG_HEX.has(full)) return 'light';
      if (full === pLow || full === dLow) return 'dark';
      return 'unknown';
    }
    // 浅底关键词
    if (/white|#fff\b|#ffffff\b|#fafafa|#f8fafc|#f1f5f9|#f3f4f6|#f9fafb/i.test(probe))
      return 'light';
    // 深底关键词：linear-gradient 包含主色 hex 或 darker hex → dark
    if (new RegExp(`${pLow.replace(/#/g, '#')}|${dLow.replace(/#/g, '#')}`, 'i').test(probe))
      return 'dark';
    return 'unknown';
  };

  const bg = detectSlideBg();

  /** 给单个 h[123] 标签 style 段 替换/追加 color 属性，返回新的 style 字符串 */
  const applyColorToStyle = (styleStr: string, targetHex: string): string => {
    // 渐变文字豁免：仅当 background-clip:text 声明"实际生效"时才豁免
    // （background 简写写在 clip 之后会把裁剪重置为 border-box，此时不算有效渐变文字，必须纠正）
    if (isEffectiveClipText(styleStr)) {
      return styleStr;
    }
    // 判断当前 color 值
    const colorMatch = styleStr.match(/(^|;)\s*color\s*:\s*([^;]*?)\s*(?=;|$)/i);
    const currentColor = colorMatch ? normHex(colorMatch[2].trim()) : '';
    const currentColorRaw = colorMatch ? colorMatch[2].trim().toLowerCase() : '';
    const targetNorm = normHex(targetHex);
    // 已是目标色（含参考标题色）→ 不写，避免覆盖参考色
    if (currentColor === targetNorm) return styleStr;
    // 当前是白字 → 浅底升级目标色场景不动（避免白字隐形）；深底场景会走 targetHex=#ffffff 分支正常升白
    if (currentColorRaw === 'white' || WHITE_HEX.has(currentColor)) return styleStr;
    // 无 color 或 中性深色 → 升级为目标色（浅底=参考标题色或主色；深底=白字）
    if (
      !colorMatch ||
      DARK_NEUTRAL_HEX.has(currentColor) ||
      DARK_NEUTRAL_HEX.has(currentColor.replace(/^#?/, '#'))
    ) {
      const prop = `color:${targetNorm}`;
      const base = styleStr.trim();
      if (!colorMatch) {
        return base.endsWith(';') ? `${base}${prop}` : `${base};${prop}`;
      }
      return base.replace(
        /(^|;)\s*color\s*:\s*[^;]*?(?=;|$)/i,
        (_m, lead) => `${lead}color:${targetNorm}`,
      );
    }
    return styleStr; // 其他非目标色（如语义绿/红）不干预
  };

  // 对 html 全局替换 <h1 / h2 / h3 标签（闭合带或不带闭合样式均可）
  const headingTagRe = /<h([123])\b([^>]*?)(\/?)>/gi;
  let result = html.replace(
    headingTagRe,
    (_fullMatch, lvl: string, attrs: string, selfClose: string) => {
      const styleRe = /style="([^"]*)"/i;
      const m = attrs.match(styleRe);
      const before = m ? attrs.substring(0, m.index!) : attrs;
      const after = m ? attrs.substring(m.index! + m[0].length) : '';
      let style = m ? m[1] : '';
      // bg=unknown 时保守：不浅不深 → 只升白（若 pageBgDark 未知则不动 primary，避免误伤）
      if (bg === 'light') {
        const lightTarget = tLow && /^#[0-9a-f]{6}$/i.test(tLow) ? tLow : pLow;
        style = applyColorToStyle(style, lightTarget);
      } else if (bg === 'dark') {
        style = applyColorToStyle(style, '#ffffff');
      }
      // bg='unknown' → 不修改，交给 Prompt 规则
      if (!m) {
        if (!style) return _fullMatch; // 既没有 style 也不需加 color → 保持原样（bg=unknown 场景常见）
        return `<h${lvl}${before}style="${style}"${after}${selfClose}>`;
      }
      return `<h${lvl}${before}style="${style}"${after}${selfClose}>`;
    },
  );
  return result;
}

// —— 终局文字对比度兜底（覆盖全部页型）：深底容器内清理渐变裁剪样式并强制白字 ——
// 置于后处理链尾，确保样式化兜底（含封面艺术字）之后再也不会把文字改暗。
export function enforceFinalTextContrast(
  html: string,
  primaryColor: string,
  colorPolicy?: SlideColorPolicy,
): string {
  // 单遍祖先栈：维护"当前生效背景 RGB"，消除非贪婪正则在嵌套 div 下的容器配对错配（根因 D）；
  // 对比度不达标才改写文字色（深底→#FFFFFF，浅底/未知→#111827），终局幂等兜底。
  // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单豁免：用户明确上传的风格色不强行改写。
  const refColorSet = new Set<string>();
  if (colorPolicy) {
    for (const c of [
      colorPolicy.titleColor,
      colorPolicy.bodyColor,
      colorPolicy.strokeColor,
      ...colorPolicy.accents,
    ]) {
      if (c) refColorSet.add(normalizeHex(c) || c.toLowerCase());
    }
  }
  // 主色 / 深色变体也纳入豁免，保护参考 accent 高亮（如 #ff4d6d）不被误改写为 #111827
  for (const c of [primaryColor, darkenPrimaryColor(primaryColor, 0.75)]) {
    if (c) refColorSet.add(normalizeHex(c) || c.toLowerCase());
  }
  const stack: Array<[number, number, number]> = [[255, 255, 255]];
  const re =
    /<(\/?)(div|section|article|body|html)([^>]*)>|<(h[1-6]|p|li|span|small|a|strong|em|b|i|u|label)([^>]*?)style="([^"]*)"([^>]*>)/gi;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[2] !== undefined && m[2] !== '') {
      // 容器标签：维护背景栈
      if (m[1] === '/') {
        if (stack.length > 1) stack.pop();
      } else {
        const styleVal = (m[3].match(/style="([^"]*)"/i) || [])[1] || '';
        const bg = resolveEffectiveBgRgb(styleVal);
        stack.push(bg || stack[stack.length - 1]);
      }
      continue;
    }
    // 文本标签（groups 4-7）：基于"最近实底祖先"的合成背景判定对比度
    const tag = m[4];
    const pre = m[5];
    const styleVal = m[6];
    const post = m[7];
    const bg = stack[stack.length - 1];
    const props = new Map<string, string>();
    for (const d of parseStyleDeclarations(styleVal)) props.set(d.key, d.value);
    const isGradientText = isEffectiveClipText(styleVal);
    const cur = (props.get('color') || '').trim();
    let newColor: string | null = null;
    if (isGradientText) {
      // 仅深底上的渐变字可能不可读 → 改纯白（浅底保留大模型渐变艺术字）
      if (relativeLuminance(bg) < 0.18) {
        newColor = '#FFFFFF';
        props.delete('background');
        props.delete('-webkit-background-clip');
        props.delete('background-clip');
        props.delete('-webkit-text-fill-color');
      }
    } else if (cur) {
      const curHex = normalizeHex(cur);
      // 参考撞色 / 标题色 / 正文色 / 描边色：用户明确上传的风格，终局对比度也不改写
      if (curHex && refColorSet.has(curHex)) {
        continue;
      }
      if (needsContrastFix(cur, bg, fontSizeOf(props), fontWeightOf(props))) {
        newColor = relativeLuminance(bg) < 0.18 ? '#FFFFFF' : '#111827';
      }
    }
    if (!newColor) continue;
    // 基于已更新的 props（含渐变分支的删除与原色替换）重建样式，保证删除/改写真正生效
    props.set('color', newColor);
    const finalStyle = Array.from(props.entries())
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    const newTag = `<${tag}${pre}style="${finalStyle}"${post}`;
    edits.push({ start: m.index, end: m.index + m[0].length, text: newTag });
  }
  let out = html;
  for (let i = edits.length - 1; i >= 0; i--) {
    out = out.slice(0, edits[i].start) + edits[i].text + out.slice(edits[i].end);
  }
  return out;
}
