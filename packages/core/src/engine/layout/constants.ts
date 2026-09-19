

export const DEFAULT_HTML = `
<div style="width: 100%; height: 100%; background-color: #fff; overflow: hidden; position: relative; box-sizing: border-box; padding: 0px;">
  <h1
    class="noppt-text-element"
    style="
      position: absolute;
      left: 530px;
      top: 200px;
      display: inline-block;
      width: auto;
      height: auto;
      padding: 4px 8px;
      font-size: 48px;
      line-height: 1.2;
      color: #1e293b;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: transparent;
      user-select: text;
    "
  >新幻灯片</h1>
</div>
`.trim();


export const COVER_CONTENT_SIGN_RE = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i;

// 多列 / 分栏结构标记：网格列定义、行向 flex、定宽百分比列（如 flex:0 0 40%）→ 内容页，禁止居中。
export const COVER_MULTI_COL_RE =
  /grid-template-columns\s*:|display\s*:\s*(?:inline-)?grid\b|flex-direction\s*:\s*row\b|flex\s*:\s*0\s+0\s+\d+%/i;

export const CONTAINER_STYLE_KEYS = new Set([
  'width',
  'height',
  'display',
  'flex-direction',
  'overflow',
  'box-sizing',
  'justify-content',
  'align-items',
  'background-color',
  'background',
  'font-family',
]);

export const CONTAINER_PADDING_PATTERN = /^48px\s+60px$/i;


/**
 * B3L：动态计算根容器 padding 默认值，与 AI 端 ensureOuterContainer、
 * 前端 security.ts#computeDefaultPadding 完全一致（AI 端 60/48 基线）。
 */
export function defaultPadYx(): string {
  // 与 web security.ts 保持一致：默认按 1280x720 基线
  const w = (globalThis as any).__NOPPT_SLIDE_WIDTH__ || 1280;
  const h = (globalThis as any).__NOPPT_SLIDE_HEIGHT__ || 720;
  const padX = Math.max(32, Math.round((60 * w) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * h) / 720 / 8) * 8);
  return `${padY}px ${padX}px`;
}
