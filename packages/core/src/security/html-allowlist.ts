/**
 * 单一真源：HTML 安全白名单。
 *
 * 历史背景：server 端（JSDOM）与 web 端（DOMParser）各自维护了一份几乎相同的
 * 白名单，但 web 端漏掉了 `data-master*` 系列属性与 `inset` 这条 CSS 属性。
 * 结果是前端 `sanitizeHtml` 会把 AI 注入的母版层/背景层元数据与定位属性剥掉，
 * 母版层/背景层退化成 0 尺寸盒子（配合 overflow:hidden）而被裁没 → 见
 * pres_mtp807ui_dnt12l9 复现样本。
 *
 * 现统一收敛到本文件，server 与 web 均引用此处，杜绝再次漂移。
 *
 * 注意：CSS 属性用 `Set`（两端均用 `.has()` 判定）；tag / attribute 用数组（两端均用 `.includes()`）。
 */

export const ALLOWED_TAGS: readonly string[] = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'strike', 'del', 'br', 'hr',
  'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'section', 'article', 'header', 'footer', 'main', 'nav',
  'aside', 'blockquote', 'pre', 'code', 'sub', 'sup', 'small',
  'font', 'mark', 'center',
  'video', 'source',
  'svg', 'path', 'circle', 'rect', 'polyline', 'polygon', 'line', 'g'
];

// 母版层与封面艺术字幂等标记（纯元数据/定位标记，无脚本/URL 危害，放行以保障重放幂等）
export const ALLOWED_ATTRIBUTES: readonly string[] = [
  'class', 'style', 'href', 'src', 'alt', 'title',
  'width', 'height', 'colspan', 'rowspan', 'target',
  'rel', 'data-element-type', 'data-group-scale-x',
  'data-group-scale-y', 'data-slide-title', 'data-slide-content',
  'data-image-ratio', 'data-noppt-id',
  // ===== 母版/封面艺术字幂等标记（必须放行，否则前端 sanitize 会把层剥成 0 尺寸）=====
  'data-master', 'data-master-hero-wrap', 'data-master-hero', 'data-master-hero-scrim',
  'data-master-logo', 'data-master-header', 'data-master-footer', 'data-master-side',
  'data-master-watermark', 'data-noppt-coverart',
  'data-layout', 'contenteditable', 'data-list-index',
  'face', 'color', 'size', 'dir',
  'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y',
  'points', 'transform', 'xmlns'
];

export const ALLOWED_CSS_PROPERTIES: ReadonlySet<string> = new Set([
  'position', 'left', 'top', 'right', 'bottom', 'width', 'height',
  'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-radius', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-color', 'border-width', 'border-style', 'border-collapse',
  'background', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat',
  'color', 'font-size', 'font-weight', 'font-style', 'font-family',
  'text-align', 'text-decoration', 'text-indent', 'line-height', 'letter-spacing',
  'vertical-align', 'white-space', 'word-break', 'word-spacing', 'overflow-wrap',
  'list-style', 'list-style-type',
  'display', 'flex', 'flex-direction', 'flex-shrink', 'flex-grow', 'flex-basis',
  'flex-wrap', 'align-items', 'align-content', 'align-self',
  'justify-content', 'justify-items', 'justify-self',
  'gap', 'grid', 'grid-template-columns', 'grid-template-rows',
  'grid-column', 'grid-row', 'grid-gap',
  'object-fit', 'object-position',
  'transform', 'transform-origin', 'scale', 'translate',
  'box-shadow', 'overflow', 'overflow-x', 'overflow-y',
  'z-index', 'cursor', 'opacity', 'visibility',
  'outline', 'outline-offset',
  'user-select', 'pointer-events', 'aspect-ratio',
  'box-sizing', 'content-visibility',
  'background-clip', '-webkit-background-clip', '-webkit-text-fill-color',
  'text-shadow',
  'backdrop-filter', '-webkit-backdrop-filter',
  'filter', '-webkit-filter',
  'clip-path', '-webkit-clip-path',
  'mix-blend-mode',
  'font-stretch', 'stroke', 'stroke-width',
  // 母版/背景层定位与开窗必需；web 端历史上漏了这条导致层被剥成 0 尺寸
  'inset',
  // ——— 保真度修复：以下属性此前不在白名单，被安全消毒误删，破坏参考风格细节 ———
  'text-transform',
  '-webkit-text-stroke', '-webkit-text-stroke-width', 'text-stroke',
  'font-variant-numeric',
  'grid-auto-flow', 'place-items', 'place-content', 'order', 'flex-flow',
  'writing-mode', 'text-overflow', 'object-fit', 'will-change',
  'transition', 'animation',
  'background-blend-mode', 'isolation'
]);

/**
 * 属性白名单的小写集合（单一真源）。
 * 修复历史 bug：SVG 的 `viewBox` 等驼峰属性在 HTML 文档里经 JSDOM/DOMParser 解析后，
 * `attr.name` 仍为驼峰（如 `viewBox`），但各端 sanitize 用 `attr.name.toLowerCase()` 比较，
 * 导致 `'viewbox' !== 'viewBox'` → 所有内联 SVG 的 viewBox 被误删、图标缩放失真。
 * 两端统一改用本集合做大小写不敏感判定。
 */
export const ALLOWED_ATTR_SET: ReadonlySet<string> = new Set(
  ALLOWED_ATTRIBUTES.map((a) => a.toLowerCase()),
);
