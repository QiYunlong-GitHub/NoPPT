import type { TemplateCtx } from './types';

const piece8 = (ctx: TemplateCtx): string => `### content-cards（卡片网格页，4个卡片）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:24px;min-height:0;align-content:center;min-width:0;">
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon0}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题一</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon1}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题二</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon2}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题三</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon3}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题四</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`
如果是3个卡片，用grid-template-columns:repeat(3,1fr)。
`;

const piece9 = (ctx: TemplateCtx): string => `### content-cards（卡片网格页，3个卡片）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;min-height:0;align-content:center;min-width:0;">
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon0}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题一</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点三的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon1}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题二</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点三的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${ctx.P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${ctx.cardIcon2}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">卡片标题三</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${ctx.P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点三的具体说明</span>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`
`;

const piece12 = (ctx: TemplateCtx): string => `### content-table（数据表格页）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:12px;border:1px solid #E5E7EB;">
    <table style="width:100%;border-collapse:collapse;font-size:18px;">
      <thead>
        <tr style="background:${ctx.GRAD};">
          <th style="padding:16px 24px;text-align:left;color:#fff;font-weight:600;font-size:18px;border-right:1px solid rgba(255,255,255,0.2);overflow-wrap:break-word;word-break:break-word;">列标题一</th>
          <th style="padding:16px 24px;text-align:left;color:#fff;font-weight:600;font-size:18px;border-right:1px solid rgba(255,255,255,0.2);overflow-wrap:break-word;word-break:break-word;">列标题二</th>
          <th style="padding:16px 24px;text-align:left;color:#fff;font-weight:600;font-size:18px;overflow-wrap:break-word;word-break:break-word;">列标题三</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#fff;">
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据一</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据二</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据三</td>
        </tr>
        <tr style="background:#F9FAFB;">
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据四</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据五</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据六</td>
        </tr>
        <tr style="background:#fff;">
          <td style="padding:16px 24px;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据七</td>
          <td style="padding:16px 24px;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据八</td>
          <td style="padding:16px 24px;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据九</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
\`\`\`
`;

const piece15 = (ctx: TemplateCtx): string => `### content-value-showcase（核心数值大卡展示 · L1高级版式 · badges+渐变巨字）
\`\`\`html
<div style="${ctx.OUTER};" data-layout="content-value-showcase">
  <h2 style="${ctx.GRAD_H2}">页面标题（核心数值展示）</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;min-height:0;align-content:stretch;min-width:0;">
    <!-- 数值大卡 1 -->
    <div style="padding:32px 24px;border-radius:20px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}1C);border:1px solid ${ctx.P}30;box-shadow:0 12px 32px ${ctx.P}20;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;">
      <div style="font-size:88px;font-weight:900;line-height:1;background:linear-gradient(135deg,${ctx.P},${ctx.PD});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
        <span style="pointer-events:none;">42%</span>
      </div>
      <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">市场份额同比</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 16px;border-radius:999px;background:#10b98118;color:#059669;font-size:20px;font-weight:800;">↗ +12.3pp</span>
      </div>
      <p style="pointer-events:none;font-size:18px;color:#6B7280;font-weight:500;margin:0;overflow-wrap:break-word;word-break:break-word;">2024 Q2 vs 2023 Q2</p>
    </div>
    <!-- 数值大卡 2 -->
    <div style="padding:32px 24px;border-radius:20px;background:linear-gradient(135deg,#05966908,#0596691C);border:1px solid #05966930;box-shadow:0 12px 32px #05966920;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;">
      <div style="font-size:88px;font-weight:900;line-height:1;background:linear-gradient(135deg,#059669,#047857);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
        <span style="pointer-events:none;">3.2×</span>
      </div>
      <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">效率提升倍数</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 16px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:20px;font-weight:800;">↗ +220%</span>
      </div>
      <p style="pointer-events:none;font-size:18px;color:#6B7280;font-weight:500;margin:0;overflow-wrap:break-word;word-break:break-word;">自动化部署前后对比</p>
    </div>
    <!-- 数值大卡 3 -->
    <div style="padding:32px 24px;border-radius:20px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}1C);border:1px solid ${ctx.P}30;box-shadow:0 12px 32px ${ctx.P}20;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;">
      <div style="font-size:88px;font-weight:900;line-height:1;background:linear-gradient(135deg,${ctx.P},${ctx.PD});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
        <span style="pointer-events:none;">120万</span>
      </div>
      <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">累计用户规模</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 16px;border-radius:999px;background:${ctx.P}18;color:${ctx.PD};font-size:20px;font-weight:800;">↗ +41% QoQ</span>
      </div>
      <p style="pointer-events:none;font-size:18px;color:#6B7280;font-weight:500;margin:0;overflow-wrap:break-word;word-break:break-word;">截至 2024 年 6 月底</p>
    </div>
  </div>
</div>
\`\`\`
如果只展示 1 个核心数值，用单列 100% 宽的超大卡（font-size 放大到 120px）。2 个数值就用 grid-template-columns:repeat(2,1fr)。
`;

const piece16 = (ctx: TemplateCtx): string => `### content-stats-highlight（多数据指标并列 · L1高级版式 · 彩色语义卡片+进度条）
\`\`\`html
<div style="${ctx.OUTER};" data-layout="content-stats-highlight">
  <h2 style="${ctx.GRAD_H2}">页面标题（多数据指标并列）</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;min-height:0;align-content:stretch;min-width:0;">
    <!-- 蓝卡：营收 -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}12;border:1px solid {{PRIMARY_COLOR}}28;box-shadow:0 6px 20px {{PRIMARY_COLOR}}18;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">¥12.8M</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">营收</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:86%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">YoY +23%</span>
    </div>
    <!-- 绿卡：毛利 -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}10;border:1px solid {{PRIMARY_COLOR}}24;box-shadow:0 6px 20px {{PRIMARY_COLOR}}16;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">¥3.2M</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">毛利</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:75%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">margin 25%</span>
    </div>
    <!-- 橙卡：留存 -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}10;border:1px solid {{PRIMARY_COLOR}}24;box-shadow:0 6px 20px {{PRIMARY_COLOR}}16;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">86%</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">客户留存</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:86%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">↗ +5.2pp</span>
    </div>
    <!-- 紫卡：DAU -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}12;border:1px solid {{PRIMARY_COLOR}}28;box-shadow:0 6px 20px {{PRIMARY_COLOR}}18;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">2.3M</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">DAU</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:72%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">QoQ +41%</span>
    </div>
  </div>
</div>
\`\`\`
3 个指标就用 grid-template-columns:repeat(3,1fr)，保持卡片数量和列数一致。
`;

export function buildDataSections(ctx: TemplateCtx): Record<number, string> {
  return {
    8: piece8(ctx),
    9: piece9(ctx),
    12: piece12(ctx),
    15: piece15(ctx),
    16: piece16(ctx),
  };
}
