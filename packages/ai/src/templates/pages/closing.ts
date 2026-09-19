import type { TemplateCtx } from './types';

const piece18 = (ctx: TemplateCtx): string => `### summary（总结页）
\`\`\`html
<div style="${ctx.OUTER};justify-content:center;align-items:center;text-align:center;">
  <div style="width:80px;height:6px;background:${ctx.P};border-radius:3px;margin-bottom:40px;"></div>
  <h2 style="${ctx.GRAD_SUMMARY}">感谢观看</h2>
  <p style="font-size:24px;color:#6B7280;margin:0 0 8px 0;overflow-wrap:break-word;word-break:break-word;">Q & A</p>
</div>
\`\`\`
`;

export function buildClosingSections(ctx: TemplateCtx): Record<number, string> {
  return {
    18: piece18(ctx),
  };
}
