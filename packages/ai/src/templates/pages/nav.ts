import type { TemplateCtx } from './types';

const piece2 = (ctx: TemplateCtx): string => `### toc（目录页）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">目录</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:24px;justify-content:center;min-height:0;">
    <div style="display:flex;align-items:center;gap:24px;padding:24px 32px;background:${ctx.P}08;border-radius:12px;min-width:0;">
      ${ctx.tocIcon0}
      <span style="font-size:20px;color:#374151;font-weight:600;overflow-wrap:break-word;word-break:break-word;">条目一</span>
    </div>
    <div style="display:flex;align-items:center;gap:24px;padding:24px 32px;background:${ctx.P}08;border-radius:12px;min-width:0;">
      ${ctx.tocIcon1}
      <span style="font-size:20px;color:#374151;font-weight:600;overflow-wrap:break-word;word-break:break-word;">条目二</span>
    </div>
    <div style="display:flex;align-items:center;gap:24px;padding:24px 32px;background:${ctx.P}08;border-radius:12px;min-width:0;">
      ${ctx.tocIcon2}
      <span style="font-size:20px;color:#374151;font-weight:600;overflow-wrap:break-word;word-break:break-word;">条目三</span>
    </div>
  </div>
</div>
\`\`\`
`;

export function buildNavSections(ctx: TemplateCtx): Record<number, string> {
  return {
    2: piece2(ctx),
  };
}
