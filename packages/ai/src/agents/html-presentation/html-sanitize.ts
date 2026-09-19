import type { SlideCritique } from '../../templates/slide-critique';
import type { SlidePlan, PresentationPlan, SlidePageType, ImageRatio } from '../../types';
import type { HTMLSlide } from './shared';
import { l0ValidateSlide } from '../../utils/l0-validation';
import {
  wrapTextNodes,
  ensureSemanticWrapping,
  findClosingTagIndex,
  getFontStack,
} from './postprocess';
import {
  renderArchitectureSvg,
  renderCycleSvg,
  renderDashboardSvg,
  renderChartSvg,
} from '../../templates/structured-graphics';
import { darkenColor, PAGE_TYPE_DEFAULT_IMAGE_RATIO } from './shared';

export function applyL0ToCritique(critique: SlideCritique, html: string, pageType: string): void {

    const l0 = l0ValidateSlide(html, pageType);
    if (l0.length === 0) return;
    for (const issue of l0) {
      critique.issues.push({
        severity: issue.severity,
        title: `L0硬校验·${issue.rule}`,
        current: issue.detail,
        problem: issue.detail,
        fix: '请修正该 L0 底线违规（正文字号 ≥ 12px，文本与背景对比度 ≥ 4.5:1）',
      });
    }
    if (l0.some((i) => i.severity === 'fatal')) {
      critique.passed = false;
      critique.overallScore = Math.min(critique.overallScore, 4.5);
    }
  
}

export function sanitizeStyleSyntax(html: string): string {

    // 1) 常规闭合 style 属性处理（幂等：只补分隔符）
    const processed = html.replace(
      /(style=)(['"])([\s\S]*?)\2/gi,
      (whole, _k: string, _q: string, styleBody: string) => {
        let fixed = styleBody;
        // ① 值→下一属性名粘接（仅当值末尾无空格且下一字符为字母/连字符）
        fixed = fixed.replace(/([0-9.]+(?:px|em|rem|%))(?![0-9.\s;"'])([A-Za-z-])/g, '$1;$2');
        // ② px 后直接 属性名+:  (第一规则可能因数字带小数点未覆盖，此处兜底)
        fixed = fixed.replace(/(\d+px)([A-Za-z-]{2}:)/g, '$1;$2');
        // ③ rgba(...)/var(...) 的 ) 后直接下一属性名:
        fixed = fixed.replace(/(\))([A-Za-z-]{2}:)/g, '$1;$2');
        return fixed === styleBody ? whole : whole.replace(styleBody, fixed);
      },
    );

    // 2) 未闭合引号检测（到下一个 > 前无配对引号）→ 不做强拆，仅告警
    processed.replace(
      /(style=)(['"])((?:[^"'>]|(?!\2))*?)(>)/gi,
      (whole, _k: string, q: string, inner: string) => {
        console.warn('[STYLE] 未闭合引号，跳过整形:', `${q}${inner.slice(0, 60)}`);
        return whole;
      },
    );

    return processed;
  
}

export function injectStructuredGraphics(
    html: string,
    slidePlan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
  ): string {

    if (!html || !slidePlan) return html;
    try {
      const opts = { primaryColor, primaryColorDarker };
      // 顺序无关：用 lookahead 同时要求 class 含 structured-graphic 且存在 data-graphic-slot
      const slotRe =
        /<div\b(?=[^>]*\bclass="[^"]*structured-graphic)(?=[^>]*\bdata-graphic-slot="([^"]*)")[^>]*>([\s\S]*?)<\/div>/g;
      let injected = false;
      const out = html.replace(slotRe, (full, slot: string, _inner: string) => {
        let svg = '';
        const pt = slidePlan.pageType;
        try {
          if (slot === 'architecture' && slidePlan.architecture) {
            svg = renderArchitectureSvg(slidePlan.architecture, opts);
          } else if (slot === 'cycle' && pt === 'content-cycle') {
            svg = renderCycleSvg(slidePlan.keyPoints || [], opts);
          } else if (slot === 'dashboard' && pt === 'content-dashboard') {
            svg = renderDashboardSvg(slidePlan.showcaseMetrics || [], opts, slidePlan.chart);
          } else if (
            slidePlan.chart &&
            (slot === 'chart' ||
              slot === 'bar' ||
              slot === 'line' ||
              slot === 'pie' ||
              slot === 'donut')
          ) {
            svg = renderChartSvg(slidePlan.chart, opts);
          }
        } catch {
          svg = '';
        }
        if (!svg) return full; // 无对应 SVG：保持占位符原样，不破坏页面
        injected = true;
        return `<div class="structured-graphic" data-graphic-slot="${slot}">${svg}</div>`;
      });
      if (injected) {
        console.log(
          '[POST][injectStructuredGraphics] 已注入受控 SVG 图形（pageType=' +
            (slidePlan.pageType || '?') +
            '）',
        );
      }
      return out;
    } catch (e) {
      console.warn(
        `[POST][injectStructuredGraphics] 注入失败，降级跳过:`,
        e instanceof Error ? e.message : e,
      );
      return html;
    }
  
}

export function enforceSingleColumn(html: string, pageType: string): string {

    if (pageType !== 'content-image-left' && pageType !== 'content-image-right') {
      return html;
    }
    return html.replace(/<(ul|ol)\b([^>]*)/gi, (whole, tag: string, attrs: string) => {
      const sm = /style\s*=\s*(['"])([\s\S]*?)\1/gi.exec(attrs);
      if (!sm) return whole;
      const styleAttrWhole = sm[0];
      const quote = sm[1];
      const styleBody = sm[2];
      // 仅当 style 含 grid/repeat/minmax/column-count 时才需要重构
      if (!/(grid|\brepeat\b|\bminmax|column-count)/i.test(styleBody)) {
        return whole;
      }
      let fixed = styleBody;
      // a) display:grid → display:flex
      fixed = fixed.replace(/display\s*:\s*grid/gi, 'display:flex');
      // b) grid-template-columns:repeat(2|3,1fr) → flex-direction:column
      fixed = fixed.replace(
        /grid-template-columns\s*:\s*repeat\(\s*[23]\s*,\s*1fr\s*\)/gi,
        'flex-direction:column',
      );
      // c) 双值 gap（空格分隔）→ gap:24px
      fixed = fixed.replace(/gap\s*:\s*\d+(?:\.\d+)?px\s+\d+(?:\.\d+)?px/gi, 'gap:24px');
      // d) 其余 grid-template-columns 变体（repeat(3,..) / repeat(auto-fill|auto-fit|minmax(...,...)) 等）→ 删除该属性
      fixed = fixed.replace(/grid-template-columns\s*:\s*[^;"']*?;?/gi, '');
      // 保证 flex-direction:column 在场（b/d 已写入；a 只改 display）
      if (!/flex-direction\s*:\s*column/i.test(fixed)) {
        fixed = fixed.replace(/;\s*$/, '') + (fixed ? ';' : '') + 'flex-direction:column;';
      }
      if (fixed === styleBody) return whole;
      const newAttrs = attrs.replace(styleAttrWhole, `style=${quote}${fixed}${quote}`);
      return `<${tag}${newAttrs}`;
    });
  
}

export function sanitizeRegenerationFeedback(
    feedback: string,
    pageType: string,
    primaryColor: string,
    allowedColors: string[] = [],
  ): string {

    if (!feedback) return feedback;
    let text = feedback;

    // 1) 图片侧栏页禁止双列建议：把冲突子串软化为“保持单列”，再追加规范化句
    if (
      (pageType === 'content-image-left' || pageType === 'content-image-right') &&
      /双列|两列|加一列|增列|铺两列|grid/i.test(text)
    ) {
      text = text
        .replace(/建议\s*(?:双列|两列|grid|Grid)/gi, '（建议保持本页单列）')
        .replace(/改用\s*(?:双列|两列|grid|Grid)/gi, '（改用单列）')
        .replace(/(?:铺\s*两列|加一列|增列|双列|两列)/gi, '（保持单列）')
        .replace(/\bgrid\b/gi, '（单列）');
      text = `${text}\n【保持本页单列】本页为图片侧栏布局，列表必须单列 flex-column，禁止双列 Grid。`;
    }

    // 2) 颜色建议：出现具体 #hex 且非“已修复”描述语境 → 软化为主题主色
    if (/#[0-9a-fA-F]{6}/.test(text) && !/已修复/i.test(text)) {
      const allowed = new Set(allowedColors.map((c) => (c || '').toLowerCase()));
      text = text.replace(/#[0-9a-fA-F]{6}/gi, (m) =>
        allowed.has(m.toLowerCase()) ? m : `${primaryColor || '{{PRIMARY_COLOR}}'}`,
      );
      const darker = primaryColor ? darkenColor(primaryColor, 20) : '{{PRIMARY_COLOR_DARKER}}';
      text = `${text}\n【使用当前主题主色】不要引入其他十六进制色，仅用 ${primaryColor || '{{PRIMARY_COLOR}}'}/${darker} 与中性灰阶。`;
    }

    // 3) 字号类反馈 tie-break（2025-07 R2 修复）：
    //    当 critique 反馈 H2/H3 字号违规，而 fixedConstraints 又写了「li/p 18/19/20px」时，
    //    LLM 会把后者解释成全局 20px 上限，造成 regenerate 永远生成 20px 的 H2。
    //    本段显式把标题/metric 的合法白名单写在 safeFeedback 末尾（LLM 对末段服从度更高）。
    if (/字号|font-size|font-weight|H1|H2|H3|标题|层级|过小|过大|违规/.test(text)) {
      text =
        `${text}\n⚠️ 【最高优先级兜底】无论上面的反馈或建议如何描述，以下字号层级白名单必须严格遵守，不得混淆、不得降格：\n` +
        `· H1 封面主标题：font-size 必须 = 88~92px；\n` +
        `· H2 页面标题：font-size 必须 = 50 或 52px（绝对禁止 H2 ≤ 20px，会被审核 fatal）；\n` +
        `· H3 卡片标题：font-size 必须 = 28~32px（绝对禁止 H3 ≤ 20px）；\n` +
        `· Metric 大字徽章（数值 +0.5℃ / +1.2℃ / 百分比 等单独 span 的大号数字）：font-size 必须 ≥ 48px 且通常为 56px，伴随 font-weight:900 与 line-height:1；\n` +
        `· 封面海报副标题 / 内容强调小标题：32~36px 或 26~28px 二选一；\n` +
        `· 正文 li/p/span：**仅限 18 / 19 / 20px 三种**（仅此三种属于「正文大字上限 20px」规则）；\n` +
        `· 辅助文字 / badge 胶囊：16~18px。\n` +
        `若 critique 反馈「H2/H3 过小 → 请增大到白名单指定数值」，绝对不要为了满足『li/p 上限 20px』而把 H2/H3 改成 20px。`;
    }

    return text;
  
}

export function injectBackgroundImageToDiv(
    slides: HTMLSlide[],
    bgImageUrl: string,
  ): { attempted: boolean; injected: number } {

    if (!slides || !slides.length || !bgImageUrl) return { attempted: false, injected: 0 };
    const escapedUrl = String(bgImageUrl).replace(/"/g, '&quot;');
    const inlineStyle = `background-image:url('${escapedUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;`;
    let injected = 0;
    for (const slide of slides) {
      if (!slide || !slide.html) continue;
      // 命中最外层 <div style="..."> 的 style 属性；若没 style 属性就不注入（避免复杂的 HTML 插入，出错概率低）
      if (/style="[^"]*"/i.test(slide.html)) {
        const before = slide.html;
        // 在现有 style 开头插入背景样式，避免被可能存在的末尾 overflow:hidden 等截断问题影响
        slide.html = slide.html.replace(/style="/i, `style="${inlineStyle}`);
        if (slide.html !== before) injected++;
      }
    }
    return { attempted: true, injected };
  
}

export function generateFallbackSlide(
    plan: SlidePlan,
    primaryColor: string,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    iconStyle?: string,
  ): string {

    const marker = iconStyle === 'checkmark' ? '✔' : iconStyle === 'number' ? '' : '●';
    const keyPointsHtml = (plan.keyPoints || [])
      .map((p, i) => {
        const prefix =
          iconStyle === 'number'
            ? `<span style="color:${primaryColor};font-weight:700;margin-right:10px;">${i + 1}.</span>`
            : `<span style="color:${primaryColor};margin-right:10px;">${marker}</span>`;
        return `<li style="list-style:none;display:flex;align-items:flex-start;font-size:18px;line-height:2;color:#374151;">${prefix}<span style="flex:1;">${p}</span></li>`;
      })
      .join('');
    const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
    const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
    const primaryColorDarker = darkenColor(primaryColor, 20);
    const fontStack = getFontStack(fontFamily);
    const h2Style = `font-size:48px;font-weight:700;margin:0 0 32px 0;line-height:1.25;background:linear-gradient(135deg,${primaryColor},${primaryColorDarker});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`;
    // data-degraded="true"：标记该页为「大模型生成失败后的极简兜底」，供前端识别并提示「单页重新生成」。
    return `<div data-degraded="true" style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${padY}px ${padX}px;display:flex;flex-direction:column;background-color:#fff;font-family:${fontStack};">
  <h2 style="${h2Style}">${plan.title}</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;overflow:hidden;justify-content:center;">
    ${keyPointsHtml ? `<ul style="font-size:18px;line-height:2;color:#374151;margin:0;padding-left:0;">${keyPointsHtml}</ul>` : ''}
  </div>
</div>`;
  
}

export function buildReferenceSeedMap(
    options: any,
  ): Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined {

    const rva = options?.referenceVisualAttributes;
    if (!rva || !rva.byCategory) return undefined;
    return {
      cover: rva.byCategory.cover?.referenceImageUrl,
      content: rva.byCategory.content?.referenceImageUrl,
      summary: rva.byCategory.summary?.referenceImageUrl,
      global: rva.global?.referenceImageUrl,
    };
  
}

export function parsePlan(content: string): PresentationPlan {

    const jsonStr = extractJson(content);
    try {
      const data = JSON.parse(jsonStr);
      const slides: SlidePlan[] = Array.isArray(data.slides)
        ? data.slides.map((s: any) => {
            const pageType = (s.pageType as SlidePageType) || 'content-no-image';
            const needsImage =
              !!s.needsImage &&
              ['content-image-left', 'content-image-right', 'content-image-top'].includes(pageType);
            return {
              pageType,
              title: s.title || '',
              keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.filter(Boolean) : [],
              imagePrompt: typeof s.imagePrompt === 'string' ? s.imagePrompt : undefined,
              imageRatio:
                (s.imageRatio as ImageRatio) ||
                PAGE_TYPE_DEFAULT_IMAGE_RATIO[pageType] ||
                undefined,
              needsImage,
              backgroundPrompt:
                typeof s.backgroundPrompt === 'string' && s.backgroundPrompt
                  ? s.backgroundPrompt
                  : undefined,
            };
          })
        : [];
      return {
        title: data.title || '演示文稿',
        description: data.description,
        primaryColor: data.primaryColor || '#2563eb',
        slides:
          slides.length > 0
            ? slides
            : [
                {
                  pageType: 'cover',
                  title: data.title || '演示文稿',
                  keyPoints: [],
                  needsImage: false,
                },
                { pageType: 'content-no-image', title: '内容', keyPoints: [], needsImage: false },
              ],
      };
    } catch (e) {
      console.error('Failed to parse presentation plan JSON:', e);
      return {
        title: '演示文稿',
        primaryColor: '#2563eb',
        slides: [
          { pageType: 'cover', title: '演示文稿', keyPoints: [], needsImage: false },
          { pageType: 'content-no-image', title: '内容', keyPoints: [], needsImage: false },
        ],
      };
    }
  
}

export function sanitizeSlideHtml(html: string): string {

    if (!html || !html.trim()) {
      return '<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 60px;display:flex;align-items:center;justify-content:center;"><p style="font-size:24px;color:#999;">空幻灯片</p></div>';
    }
    let result = html.trim();
    result = result.replace(/<script[\s\S]*?<\/script>/gi, '');
    result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
    result = result.replace(/on\w+="[^"]*"/gi, '');
    result = result.replace(/on\w+='[^']*'/gi, '');
    result = wrapTextNodes(result);
    result = flattenMeaninglessNesting(result);
    result = ensureSemanticWrapping(result);
    return result;
  
}

export function flattenMeaninglessNesting(html: string): string {

        let result = html;
    let iterations = 0;
    const maxIterations = 10;
    // FR-1a: 扩展为"视觉属性 + 布局约束"双重判定——margin/overflow/flex/显式宽高/padding
    // 等布局关键属性存在时，容器不可被 flatten 错误剥离（slide-04 图片容器 margin-top:32px 被吞的直接修复）
    const hasVisualStyleOrLayoutConstraint = (styleAttr: string): boolean => {
      const lower = styleAttr.toLowerCase();
      // --- 原有视觉属性判定（完全保留）---
      const hasVisual =
        (lower.includes('background') &&
          (lower.includes('color') || lower.includes('image') || lower.includes('gradient'))) ||
        lower.includes('border') ||
        lower.includes('box-shadow') ||
        lower.includes('border-radius');
      if (hasVisual) return true;
      // --- 新增：影响布局/间距/溢出的关键约束（RC-1 修复）---
      const hasMargin =
        /(^|;)\s*margin\s*:\s*[^;]*\d/i.test(lower) ||
        /(^|;)\s*margin-(top|bottom|left|right)\s*:/i.test(lower);
      const hasPadding =
        /(^|;)\s*padding\s*:\s*[^;]*\d/i.test(lower) ||
        /(^|;)\s*padding-(top|bottom|left|right)\s*:/i.test(lower);
      const hasOverflow = /(^|;)\s*overflow(-[xy])?\s*:/i.test(lower);
      const hasFlex = /(^|;)\s*flex(-(grow|shrink|basis))?\s*:/i.test(lower);
      const hasAspectRatio = /(^|;)\s*aspect-ratio\s*:/i.test(lower);
      const sizeRe = /(^|;)\s*(width|height)\s*:\s*([^;]+)/gi;
      let hasExplicitSize = false;
      let sm: RegExpExecArray | null;
      while ((sm = sizeRe.exec(lower)) !== null) {
        const v = (sm[3] || '').trim().toLowerCase();
        if (!v) continue;
        if (
          v === 'auto' ||
          v === 'inherit' ||
          v === 'initial' ||
          v === 'unset' ||
          v === 'fit-content' ||
          v === 'max-content' ||
          v === 'min-content'
        )
          continue;
        if (/\d/.test(v)) {
          hasExplicitSize = true;
          break;
        }
      }
      return hasMargin || hasPadding || hasOverflow || hasFlex || hasAspectRatio || hasExplicitSize;
    };
    const getStyleAttr = (tag: string): string => {
      const match = tag.match(/style="([^"]*)"/i);
      return match ? match[1] : '';
    };
    const hasOnlyOneChild = (
      innerContent: string,
    ): { onlyChild: boolean; childTag?: string; childFull?: string } => {
      const trimmed = innerContent.trim();
      if (!trimmed) return { onlyChild: false };
      const firstTagMatch = trimmed.match(/^<([a-zA-Z0-9]+)(\s[^>]*)?>/);
      if (!firstTagMatch) return { onlyChild: false };
      const childTag = firstTagMatch[1].toLowerCase();
      const isSelfClosing =
        firstTagMatch[0].endsWith('/>') || ['br', 'img', 'hr', 'input'].includes(childTag);
      if (isSelfClosing) {
        const rest = trimmed.slice(firstTagMatch[0].length).trim();
        return { onlyChild: rest.length === 0, childTag, childFull: firstTagMatch[0] };
      }
      const closingTag = `</${childTag}>`;
      const closingIndex = findClosingTagIndex(trimmed, childTag);
      if (closingIndex === -1) return { onlyChild: false };
      const before = trimmed.slice(0, firstTagMatch.index).trim();
      const after = trimmed.slice(closingIndex + closingTag.length).trim();
      if (before.length === 0 && after.length === 0) {
        return {
          onlyChild: true,
          childTag,
          childFull: trimmed.slice(0, closingIndex + closingTag.length),
        };
      }
      return { onlyChild: false };
    };
    const flattenOnce = (htmlStr: string): string => {
      const divRegex = /<(div|section|article)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
      return htmlStr.replace(divRegex, (match, tag, attrs, innerContent) => {
        // F6：母版层（class="noppt-master-layer"）整体豁免 flatten，避免 header/logo 容器被折叠裸出
        if (/class\s*=\s*["'][^"']*noppt-master-layer/i.test(attrs || '')) return match;
        const styleAttr = getStyleAttr(match);
        if (hasVisualStyleOrLayoutConstraint(styleAttr)) {
          const innerFlattened = flattenOnce(innerContent);
          return innerFlattened === innerContent
            ? match
            : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
        }
        const childInfo = hasOnlyOneChild(innerContent);
        if (!childInfo.onlyChild || !childInfo.childTag) {
          const innerFlattened = flattenOnce(innerContent);
          return innerFlattened === innerContent
            ? match
            : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
        }
        // FR-1b: 图片包裹保护——直接子代是 <img> 时，无论容器是否有样式，均不剥离外层
        // （图片包裹对 flex:column / grid 等布局至关重要，丢掉外层会让 height:100% 挤爆画布）
        if (childInfo.childTag === 'img') {
          const innerFlattened = flattenOnce(innerContent);
          return innerFlattened === innerContent
            ? match
            : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
        }
        if (
          ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'ul', 'ol', 'table'].includes(
            childInfo.childTag,
          )
        ) {
          return childInfo.childFull!;
        }
        const innerFlattened = flattenOnce(innerContent);
        return innerFlattened === innerContent
          ? match
          : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
      });
    };
    do {
      const before = result;
      result = flattenOnce(result);
      iterations++;
      if (result === before) break;
    } while (iterations < maxIterations);
    return result;
  
}

export function extractJson(content: string): string {

    const trimmed = content.trim();
    if (trimmed.startsWith('{')) return trimmed;
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
  
}

export function extractHtml(content: string): string {

    const trimmed = content.trim();
    const match = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
    const firstDiv = trimmed.indexOf('<div');
    const lastDiv = trimmed.lastIndexOf('</div>');
    if (firstDiv !== -1 && lastDiv !== -1 && lastDiv > firstDiv) {
      return trimmed.slice(firstDiv, lastDiv + 6);
    }
    return trimmed;
  
}
