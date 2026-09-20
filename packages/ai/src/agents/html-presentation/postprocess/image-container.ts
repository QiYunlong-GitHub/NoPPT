import type { SlidePlan } from '../../../types';
import { PAGE_TYPE_DEFAULT_IMAGE_RATIO } from '../image-sizing';
import { parseStyleDeclarations } from '@noppt/core';

/**
 * PostProcess 图片容器簇（从 postprocess/layout.ts 外置）。
 *
 * 外置原因：layout.ts 触及门禁的 800 行上限；图片容器样式 / 图片包裹兜底 /
 * 图片比例注入是一组内聚且与文本无关的纯函数，整体搬出后 layout.ts 与新增文件
 * 均远低于阈值（门禁只减不增）。
 *
 * 纯函数，无 this 依赖；layout.ts 会再导出以保持 postprocess barrel 的对外签名不变。
 */
export function enforceImageContainerStyles(html: string): string {
  const imgContainerRegex = /<div([^>]*style="[^"]*"[^>]*)>[\s\S]*?<img[^>]*>[\s\S]*?<\/div>/gi;
  return html.replace(imgContainerRegex, (match) => {
    const openTagEnd = match.indexOf('>');
    const openTag = match.substring(0, openTagEnd + 1);
    if (!/style="[^"]*"/i.test(openTag)) return match;
    // B3：改用 Map 精确控制"缺省才补"，不再用 includes 粗判（容易误伤复合属性名）
    const styleMatchInner = openTag.match(/style="([^"]*)"/i);
    if (!styleMatchInner) return match;
    const props = new Map<string, string>();
    for (const d of parseStyleDeclarations(styleMatchInner[1])) props.set(d.key, d.value);
    // —— T6-FR6 防误伤：跳过 width:100% + height:100% 的外层画布根容器 ——
    // 该函数只应为 "紧包 <img> 的图片列" 注入 display:flex 与居中对齐；
    // 外层根容器被误加 justify-content:center 会把 <h2> 强制挤到页面中部，造成大面积空白。
    const w = (props.get('width') || '').trim();
    const h = (props.get('height') || '').trim();
    if (w === '100%' && h === '100%') return match;
    if (!props.has('overflow')) props.set('overflow', 'hidden');
    if (!props.has('min-height')) props.set('min-height', '0');
    if (!props.has('max-height')) props.set('max-height', '100%');
    const hadDisplay = props.has('display');
    if (!hadDisplay) props.set('display', 'flex');
    // 只有显式注入了 display:flex 且没指定对齐的情况下，才给居中对齐默认值；AI 原本就有 display 或已有对齐则完全保留
    if ((props.get('display') || '').trim() === 'flex') {
      if (!props.has('align-items')) props.set('align-items', 'center');
      if (!props.has('justify-content')) props.set('justify-content', 'center');
    }
    const ns = Array.from(props.entries())
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    const newOpen = openTag.replace(/style="[^"]*"/i, `style="${ns}"`);
    return newOpen + match.substring(openTagEnd + 1);
  });
}


export function ensureImageProperWrapper(html: string): string {
  if (!html) return html;
  // 匹配：块级关闭标签 → 裸 img → 根容器关闭标签
  // 例：</div> → <img...> → </div>
  // 注意：不匹配 </div><div style="margin-top:…"><img> → </div>（即 img 已有包裹时不重套）
  const bareImgRe =
    /(<\/(?:div|h[1-6]|ul|ol|p|table|section|article)\s*>)(\s*)(<img\b[^>]*>)(\s*)(?=<\/(?:div|section|article)\s*>)/gi;
  let changed = false;
  const output = html.replace(
    bareImgRe,
    (_full, prevClose: string, ws1: string, imgTag: string, ws2: string) => {
      changed = true;
      const wrap =
        '<div style="margin-top:24px;overflow:hidden;display:flex;align-items:stretch;min-height:0;flex:0 0 auto;">' +
        imgTag +
        '</div>';
      return prevClose + ws1 + wrap + ws2;
    },
  );
  if (changed) return output;
  // === 兜底 B：没有命中根容器关闭标签模式？再看 "根容器内 img 是第一个孩子"的情况（少见，但仍防御）
  const firstBareImgRe =
    /(<(?:div|section|article)\b[^>]*style\s*=\s*"[^"]*flex-direction\s*:\s*column[^"]*"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*)(<img\b[^>]*>)/gi;
  return html.replace(firstBareImgRe, (_full, opener: string, imgTag: string) => {
    return (
      opener +
      '<div style="margin-bottom:24px;overflow:hidden;display:flex;align-items:stretch;min-height:0;flex:0 0 auto;">' +
      imgTag +
      '</div>'
    );
  });
}


export function ensureImageRatio(html: string, plan: SlidePlan): string {
  const expectedRatio = plan.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[plan.pageType];
  if (!expectedRatio) return html;
  return html.replace(/<img([^>]*)>/gi, (match, attrs) => {
    if (attrs.includes('data-image-ratio')) return match;
    return `<img${attrs} data-image-ratio="${expectedRatio}">`;
  });
}

