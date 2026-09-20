import type { TemplateCtx } from './types';

const piece10 = (ctx: TemplateCtx): string => `### content-compare（两栏对比 · 右栏浅底禁白字，强制主色字）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;gap:32px;min-height:0;min-width:0;align-items:stretch;">
    <div style="flex:1;padding:32px;border-radius:16px;border:2px solid #E5E7EB;display:flex;flex-direction:column;gap:24px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:700;color:#374151;margin:0;text-align:center;padding-bottom:16px;border-bottom:2px solid #E5E7EB;overflow-wrap:break-word;word-break:break-word;">左栏标题</h3>
      <ul style="font-size:22px;color:#374151;margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${ctx.cmpLeft}<span style="line-height:1.4;flex:1;">对比项一</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${ctx.cmpLeft}<span style="line-height:1.4;flex:1;">对比项二</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${ctx.cmpLeft}<span style="line-height:1.4;flex:1;">对比项三</span></li>
      </ul>
    </div>
    <div style="flex:1;padding:32px;border-radius:16px;background:${ctx.P}08;border:2px solid ${ctx.P};display:flex;flex-direction:column;gap:24px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;padding-bottom:16px;border-bottom:2px solid ${ctx.P}30;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">右栏标题</h3>
      <ul style="font-size:22px;color:#374151;margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${ctx.cmpRight}<span style="line-height:1.4;flex:1;color:#111827;font-weight:600;">对比项一</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${ctx.cmpRight}<span style="line-height:1.4;flex:1;color:#111827;font-weight:600;">对比项二</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${ctx.cmpRight}<span style="line-height:1.4;flex:1;color:#111827;font-weight:600;">对比项三</span></li>
      </ul>
    </div>
  </div>
</div>
\`\`\`
`;

const piece13 = (ctx: TemplateCtx): string => `### comparison-deep-dive（双栏深度对比报告 · L1高级版式 · 进度条+徽章）
⚠️ 图例说明（放在模板顶部，生成页面时也默认生成这一行便于阅读）：
  ▢ 灰色外框卡片 = 基准方案 / 现有方案　　▢ 主色外框卡片 = 升级方案 / 优势方案
  ✓ 绿色对勾图标 + 绿色"胜出"徽章 = 该维度右栏优势项（对应 advantageIndices）

🔴 左右栏度量必须完全对称（逐行等高红线）：两栏 li 的 padding / gap / 图标容器尺寸 /
   正文字号 / 进度条高度必须取**完全相同的值**，只有配色、边框色、徽章可以不同。
   任一度量不对称 → 左栏第 i 行与右栏第 i 行高度不同 → 逐行错位累积、两栏底边不齐。
   本模板已按对称值给出（li padding:16px 24px / gap:8px / 正文 20px / 进度条 8px），
   直接替换文案即可，不要自行放大右栏的 padding/字号/进度条。
\`\`\`html
<div style="${ctx.OUTER};" data-layout="comparison-deep-dive">
  <h2 style="${ctx.GRAD_H2}">页面标题（深度对比）</h2>
  <!-- 顶部图例栏（3 个图例胶囊，点击选中整个图例容器）-->
  <div style="pointer-events:none;display:flex;gap:24px;align-items:center;justify-content:center;margin-bottom:24px;min-width:0;">
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:#F9FAFB;border:1px solid #E5E7EB;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid #E5E7EB;background:#fff;"></span>
      <span style="font-size:18px;color:#4B5563;font-weight:600;">基准方案</span>
    </div>
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:${ctx.P}10;border:1px solid ${ctx.P}35;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid ${ctx.P};background:${ctx.P}05;"></span>
      <span style="font-size:18px;color:${ctx.PD};font-weight:700;">升级方案</span>
    </div>
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:#10b98112;border:1px solid #10b98135;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,${ctx.P},${ctx.PD});color:#fff;font-size:11px;font-weight:900;">✓</span>
      <span style="font-size:18px;color:#059669;font-weight:700;">右栏胜出维度</span>
    </div>
  </div>
  <div style="flex:1;display:flex;gap:28px;min-height:0;min-width:0;align-items:stretch;">
    <!-- 左栏：基准方案（灰色、普通项）-->
    <div style="flex:1;padding:24px 24px;border-radius:16px;border:2px solid #E5E7EB;background:#F9FAFB;display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:700;color:#4B5563;margin:0;text-align:center;padding-bottom:8px;border-bottom:2px solid #E5E7EB;overflow-wrap:break-word;word-break:break-word;">基准方案 / 现有方案</h3>
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:20px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度一</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:55%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:20px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度二</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:62%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:20px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度三</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:48%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:20px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度四</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:40%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
      </ul>
    </div>
    <!-- 右栏：新方案/优势方案（主色、进度条、徽章、高亮）—— 示例：advantageIndices=[0,2,3]（第1/3/4项胜出），metricValues=[92,70,95,88] -->
    <div style="flex:1;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}06,${ctx.P}0A);display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;box-shadow:0 8px 28px ${ctx.P}18;">
      <h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;padding-bottom:8px;border-bottom:2px solid ${ctx.P}35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">升级方案 / 优势方案</h3>
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <!-- 右栏第 1 项：advantageIndices 包含（✅ 胜出 → 绿色三件套 + 深渐变）-->
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #10b981;box-shadow:0 4px 16px ${ctx.P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${ctx.P},${ctx.PD});box-shadow:0 2px 8px #10b98140;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度一（优势）</span>
            <!-- 绿色胜出徽章（+92% 胜出）-->
            <span style="pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:16px;font-weight:800;white-space:nowrap;border:1px solid #10b98130;">+92% 胜出</span>
          </div>
          <!-- 进度条：主色系深一档渐变（比非优势项深，颜色用 primary/darker，不用绿色）-->
          <div style="width:100%;height:8px;border-radius:999px;background:${ctx.P}20;overflow:hidden;">
            <div style="pointer-events:none;width:92%;height:100%;border-radius:999px;background:linear-gradient(135deg,${ctx.P} 0%,${ctx.PD} 45%,${ctx.PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
        <!-- 右栏第 2 项：非 advantageIndices（普通项 → 主色蓝色三件套，渐变主色）-->
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${ctx.P},${ctx.PD});box-shadow:0 2px 8px ${ctx.P}40;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度二（普通）</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:${ctx.P}20;color:${ctx.PD};font-size:16px;font-weight:800;white-space:nowrap;">+70%</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:${ctx.P}20;overflow:hidden;">
            <div style="pointer-events:none;width:70%;height:100%;border-radius:999px;background:linear-gradient(135deg,{{PRIMARY_COLOR_LIGHTER}} 0%,${ctx.P} 45%,${ctx.PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
        <!-- 右栏第 3 项：advantageIndices 包含（✅ 胜出 → 绿色三件套 + 深渐变）-->
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #10b981;box-shadow:0 4px 16px ${ctx.P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${ctx.P},${ctx.PD});box-shadow:0 2px 8px #10b98140;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度三（优势）</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:16px;font-weight:800;white-space:nowrap;border:1px solid #10b98130;">+95% 胜出</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:${ctx.P}20;overflow:hidden;">
            <div style="pointer-events:none;width:95%;height:100%;border-radius:999px;background:linear-gradient(135deg,${ctx.P} 0%,${ctx.PD} 45%,${ctx.PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
        <!-- 右栏第 4 项：advantageIndices 包含（✅ 胜出 → 绿色三件套 + 深渐变）-->
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #10b981;box-shadow:0 4px 16px ${ctx.P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${ctx.P},${ctx.PD});box-shadow:0 2px 8px #10b98140;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度四（优势）</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:16px;font-weight:800;white-space:nowrap;border:1px solid #10b98130;">+88% 胜出</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:${ctx.P}20;overflow:hidden;">
            <div style="pointer-events:none;width:88%;height:100%;border-radius:999px;background:linear-gradient(135deg,${ctx.P} 0%,${ctx.PD} 45%,${ctx.PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`
`;

export function buildCompareSections(ctx: TemplateCtx): Record<number, string> {
  return {
    10: piece10(ctx),
    13: piece13(ctx),
  };
}
