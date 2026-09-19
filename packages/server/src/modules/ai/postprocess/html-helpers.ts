// postProcess 使用的轻量 HTML / 错误分类 helper（从 presentation.ts 外置，行为零变更）。

/** 轻量 provider 错误分类，用于给审计相关 warn 日志标注 (quota)/(network) 标记。 */
export function classifyProviderError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/403|quota|insufficient|exhausted|rate limit|429/i.test(msg)) return 'quota';
  if (/ECONN|ETIMEDOUT|timeout|network|fetch failed|socket/i.test(msg)) return 'network';
  return '';
}

/** 在既有 warn 文案上追加 provider 错误标记段（如 "(quota)" / "(network)" / ""）。 */
export function tagAuditProviderError(prefix: string, e: unknown): string {
  const kind = classifyProviderError(e);
  return kind ? `${prefix} (${kind})` : prefix;
}

// —— r6 Task3: server 侧最简兜底 HTML（白背景 + 主色渐变标题 + 主色卡片列表）——
// FR-4 改造：移除旧的 #f3f4f6 中性灰药丸（与用户主题无关、造成视觉灾难），
// 改为与 LLM 设计风格一致的白底 + 主色渐变标题 + 主色卡片（活力橙/蓝/紫均自消毒通过）。
// 新增参数 primaryColor（默认 #2563eb 蓝兼容旧调用）；字号 H2 50px / 正文 19px = 2.63 满足字号层次审计。
export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function darkenColorHex(hex: string, pct: number = 20): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const r = Math.max(0, parseInt(m[1].slice(0, 2), 16) - Math.round(255 * (pct / 100)));
  const g = Math.max(0, parseInt(m[1].slice(2, 4), 16) - Math.round(255 * (pct / 100)));
  const b = Math.max(0, parseInt(m[1].slice(4, 6), 16) - Math.round(255 * (pct / 100)));
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function buildFallbackSlideHtml(
  title: string,
  keyPoints: string[],
  slideWidth: number,
  slideHeight: number,
  primaryColor: string = '#2563eb',
): string {
  const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
  const safeTitle = escapeHtmlText(title);
  const darker = darkenColorHex(primaryColor, 20);
  // 8 位 alpha 附加：将 primaryColor #RRGGBB → #RRGGBB08 / #RRGGBB10 / #RRGGBB15
  const pc08 = `${primaryColor}08`;
  const pc10 = `${primaryColor}10`;
  const pc15 = `${primaryColor}15`;
  const pc14 = `${primaryColor}14`;
  const pc1f = `${primaryColor}1f`;
  const items = keyPoints
    .map((p) => {
      const k = escapeHtmlText(p);
      return `<li style="display:flex;align-items:center;gap:16px;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${pc08},${pc10});border-left:5px solid ${primaryColor};box-shadow:0 4px 16px ${pc15};list-style:none;margin:0;">
  <span style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,${pc14},${pc1f});display:flex;align-items:center;justify-content:center;flex-shrink:0;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
  </span>
  <span style="font-size:19px;font-weight:500;color:#111827;line-height:1.6;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">${k}</span>
</li>`;
    })
    .join('');
  return `<div style="width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:${padY}px ${padX}px;display:flex;flex-direction:column;background-color:#fff;">
  <h2 style="margin:0 0 32px 0;font-size:50px;font-weight:700;line-height:1.25;letter-spacing:-0.01em;background:linear-gradient(135deg,${primaryColor},${darker});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;overflow-wrap:break-word;word-break:break-word;">${safeTitle || '&nbsp;'}</h2>
  ${
    items
      ? `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px;">${items}</ul>`
      : ''
  }
</div>`;
}
