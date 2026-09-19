import type { TemplateCtx } from './types';

const piece3 = (ctx: TemplateCtx): string => `### content-image-left（左图右文 · 55:45比例 · 卡片条化）
**本模板为最终版式准绳：图片容器 flex:0 0 45% 且绝对不得有 margin；文字列 flex:0 0 55%；除替换文字内容外，不要改动结构与尺寸比例。**
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">
    <div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;">
      <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
    </div>
    <div style="flex:0 0 55%;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;">
      <ul style="margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;flex:1;min-height:0;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon0}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点一</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon1}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点二</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon2}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点三</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon3}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点四</span>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`
`;

const piece4 = (ctx: TemplateCtx): string => `### content-image-right（右图左文 · 55:45比例 · 卡片条化）
**本模板为最终版式准绳：图片容器 flex:0 0 45% 且绝对不得有 margin；文字列 flex:0 0 55%；除替换文字内容外，不要改动结构与尺寸比例。**
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">
    <div style="flex:0 0 55%;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;">
      <ul style="margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;flex:1;min-height:0;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon0}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点一</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon1}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点二</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon2}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点三</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}10);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;">
          ${ctx.listCardIcon3}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点四</span>
        </li>
      </ul>
    </div>
    <div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;">
      <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
    </div>
  </div>
</div>
\`\`\`
`;

const piece5 = (ctx: TemplateCtx): string => `### content-image-top（上图下文 · 要点 ≤ 3 → 单列）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:0 0 40%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;margin-bottom:20px;">
    <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="21:9" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:center;">
    <ul style="font-size:19px;color:#374151;margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:16px;">
      ${ctx.li0('核心要点一')}
      ${ctx.li1('核心要点二')}
      ${ctx.li2('核心要点三')}
    </ul>
  </div>
</div>
\`\`\`
`;

const piece6 = (ctx: TemplateCtx): string => `### content-image-top（上图下文 · 要点 ≥ 4 → 双列 Grid）
要点数 ≥ 4 时必须用以下双列 Grid 版本（图片更扁 21:9 + 图片更矮 33% + li padding/字号/icon 更紧凑）：
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:0 0 33%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;margin-bottom:16px;">
    <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="21:9" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:center;">
    <ul style="font-size:19px;color:#374151;margin:0;padding:0;list-style:none;min-width:0;display:grid;grid-template-columns:repeat(2,1fr);gap:16px 24px;">
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;list-style:none;">
        ${ctx.gridCardIcon0}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点一</span>
      </li>
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;list-style:none;">
        ${ctx.gridCardIcon1}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点二</span>
      </li>
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;list-style:none;">
        ${ctx.gridCardIcon2}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点三</span>
      </li>
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;list-style:none;">
        ${ctx.gridCardIcon3}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点四</span>
      </li>
    </ul>
  </div>
</div>
\`\`\`
`;

const piece7 = (ctx: TemplateCtx): string => `### content-no-image（纯文字内容页）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden;justify-content:center;">
    <ul style="font-size:20px;color:#374151;margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;">
      ${ctx.li0('核心要点一')}
      ${ctx.li1('核心要点二')}
      ${ctx.li2('核心要点三')}
      ${ctx.li3('核心要点四')}
      ${ctx.li4('核心要点五')}
    </ul>
  </div>
</div>
\`\`\`
`;

const piece11 = (ctx: TemplateCtx): string => `### content-timeline（时间轴页）
\`\`\`html
<div style="${ctx.OUTER};">
  <h2 style="${ctx.GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0;overflow:hidden;justify-content:center;position:relative;padding-left:56px;">
    <div style="position:absolute;left:27px;top:16px;bottom:16px;width:4px;background:${ctx.P}20;border-radius:2px;"></div>
    <div style="display:flex;gap:24px;align-items:center;min-width:0;">
      <div style="flex-shrink:0;margin-left:-56px;z-index:1;position:relative;">${ctx.tlIcon0}</div>
      <div style="flex:1;padding-bottom:24px;min-width:0;">
        <h3 style="font-size:22px;font-weight:700;color:${ctx.P};margin:0 0 8px 0;line-height:1.4;overflow-wrap:break-word;word-break:break-word;">第一阶段标题</h3>
        <p style="font-size:18px;line-height:1.7;color:#6B7280;margin:0;overflow-wrap:break-word;word-break:break-word;">简要描述</p>
      </div>
    </div>
    <div style="display:flex;gap:24px;align-items:center;min-width:0;">
      <div style="flex-shrink:0;margin-left:-56px;z-index:1;position:relative;">${ctx.tlIcon1}</div>
      <div style="flex:1;padding-bottom:24px;min-width:0;">
        <h3 style="font-size:22px;font-weight:700;color:${ctx.P};margin:0 0 8px 0;line-height:1.4;overflow-wrap:break-word;word-break:break-word;">第二阶段标题</h3>
        <p style="font-size:18px;line-height:1.7;color:#6B7280;margin:0;overflow-wrap:break-word;word-break:break-word;">简要描述</p>
      </div>
    </div>
    <div style="display:flex;gap:24px;align-items:center;min-width:0;">
      <div style="flex-shrink:0;margin-left:-56px;z-index:1;position:relative;">${ctx.tlIcon2}</div>
      <div style="flex:1;padding-bottom:0;min-width:0;">
        <h3 style="font-size:22px;font-weight:700;color:${ctx.P};margin:0 0 8px 0;line-height:1.4;overflow-wrap:break-word;word-break:break-word;">第三阶段标题</h3>
        <p style="font-size:18px;line-height:1.7;color:#6B7280;margin:0;overflow-wrap:break-word;word-break:break-word;">简要描述</p>
      </div>
    </div>
  </div>
</div>
\`\`\`
`;

const piece14 = (ctx: TemplateCtx): string => `### content-zigzag（Z字形图文交错 · L1高级版式 · 三段式）
\`\`\`html
<div style="${ctx.OUTER};" data-layout="content-zigzag">
  <h2 style="${ctx.GRAD_H2}">页面标题（Z字三段式）</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;">
    <!-- 第一段：图左文右 -->
    <div style="display:flex;gap:24px;align-items:stretch;min-height:0;min-width:0;flex:1;">
      <div style="flex:0 0 38%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:14px;">
        <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:14px;display:block;">
      </div>
      <div style="flex:1;display:flex;align-items:center;min-height:0;min-width:0;">
        <div style="padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;flex:1;">
          <h3 style="font-size:26px;font-weight:800;margin:0 0 10px 0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">第一阶段 · 图左文右</h3>
          <p style="font-size:22px;color:#374151;font-weight:500;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">第一部分内容描述，图文左右排列，形成 Z 字视觉流的第一段。文字放在带主色左侧竖线的渐变卡片里，清晰可读。</p>
        </div>
      </div>
    </div>
    <!-- 第二段：文左图右（方向反转）-->
    <div style="display:flex;gap:24px;align-items:stretch;min-height:0;min-width:0;flex:1;">
      <div style="flex:1;display:flex;align-items:center;min-height:0;min-width:0;">
        <div style="padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-right:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;flex:1;">
          <h3 style="font-size:26px;font-weight:800;margin:0 0 10px 0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">第二阶段 · 文左图右</h3>
          <p style="font-size:22px;color:#374151;font-weight:500;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">第二部分内容描述，文字在左图片在右，方向与第一段反转，形成 Z 字视觉流的中间转折。卡片改成右侧竖线保持视觉平衡。</p>
        </div>
      </div>
      <div style="flex:0 0 38%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:14px;">
        <div style="pointer-events:none;flex:1;border-radius:14px;background:linear-gradient(135deg,${ctx.P}15,${ctx.PD}20);display:flex;align-items:center;justify-content:center;">
          ${ctx.zigzagIcon1}
        </div>
      </div>
    </div>
    <!-- 第三段：图左文右（回到第一段方向）-->
    <div style="display:flex;gap:24px;align-items:stretch;min-height:0;min-width:0;flex:1;">
      <div style="flex:0 0 38%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:14px;">
        <div style="pointer-events:none;flex:1;border-radius:14px;background:linear-gradient(135deg,${ctx.PD}20,${ctx.P}15);display:flex;align-items:center;justify-content:center;">
          ${ctx.zigzagIcon2}
        </div>
      </div>
      <div style="flex:1;display:flex;align-items:center;min-height:0;min-width:0;">
        <div style="padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,${ctx.P}08,${ctx.P}12);border-left:5px solid ${ctx.P};box-shadow:0 4px 16px ${ctx.P}15;min-width:0;flex:1;">
          <h3 style="font-size:26px;font-weight:800;margin:0 0 10px 0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_H3_CARD}">第三阶段 · 回到图左</h3>
          <p style="font-size:22px;color:#374151;font-weight:500;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">第三部分内容描述，图片重新回到左侧，与第一段方向一致，完成 Z 字形三段式的视觉收尾。整个页面节奏富有韵律。</p>
        </div>
      </div>
    </div>
  </div>
</div>
\`\`\`
⚠️ 注意：content-zigzag 中仅第一段保留真实 img 占位符（NOPPT_IMAGE_PLACEHOLDER），后两段用 emoji+渐变色块代替，避免触发"每页多图占位符"违规。
`;

const piece17 = (ctx: TemplateCtx): string => `### content-image-background（大图背景+玻璃卡片叠层 · L1高级版式 · backdrop-filter玻璃拟态）
\`\`\`html
<div style="${ctx.OUTER};padding:0;" data-layout="content-image-background">
  <!-- 全屏背景图（先占位，等实际图替换）-->
  <div style="position:absolute;inset:0;overflow:hidden;z-index:0;">
    <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="16:9" style="width:100%;height:100%;object-fit:cover;display:block;">
    <!-- 背景暗化蒙版：保证文字可读性 -->
    <div style="pointer-events:none;position:absolute;inset:0;background:linear-gradient(135deg,rgba(17,24,39,0.55),rgba(17,24,39,0.25));"></div>
  </div>
  <!-- 内容层：玻璃卡片叠在背景图上 -->
  <div style="position:relative;z-index:1;width:100%;height:100%;padding:${ctx.PY}px ${ctx.PX}px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;min-height:0;min-width:0;">
    <h2 style="font-size:44px;font-weight:800;margin:0 0 32px 0;line-height:1.25;letter-spacing:-0.01em;overflow-wrap:break-word;word-break:break-word;color:#FFFFFF;text-shadow:0 2px 12px rgba(0,0,0,0.4);">页面标题（叠在背景图上）</h2>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;min-width:0;">
      <!-- 玻璃卡片 1（✅ 可选中：有 background+backdrop-filter+border+border-radius+box-shadow）-->
      <div style="padding:28px 32px;border-radius:16px;background:rgba(255,255,255,0.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.12);display:flex;flex-direction:column;gap:12px;min-width:0;">
        <h3 style="font-size:28px;font-weight:800;margin:0;color:${ctx.PD};overflow-wrap:break-word;word-break:break-word;">玻璃卡片标题一</h3>
        <p style="font-size:22px;color:#111827;font-weight:600;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">正文内容文字，玻璃背景衬底清晰可读，半透明+模糊让背景图透出来但不影响阅读。</p>
      </div>
      <!-- 玻璃卡片 2 -->
      <div style="padding:28px 32px;border-radius:16px;background:rgba(255,255,255,0.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.12);display:flex;flex-direction:column;gap:12px;min-width:0;">
        <h3 style="font-size:28px;font-weight:800;margin:0;color:${ctx.PD};overflow-wrap:break-word;word-break:break-word;">玻璃卡片标题二</h3>
        <p style="font-size:22px;color:#111827;font-weight:600;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">正文内容文字。backdrop-filter 必须同时写标准属性 + -webkit- 前缀，确保 Safari 兼容。</p>
      </div>
    </div>
  </div>
</div>
\`\`\`
content-image-background 只有 1 张图（全屏背景图），符合"每页一张 img 占位符"约束。文字卡片都放在玻璃容器内（✅ 可选中编辑）。
`;

export function buildContentSections(ctx: TemplateCtx): Record<number, string> {
  return {
    3: piece3(ctx),
    4: piece4(ctx),
    5: piece5(ctx),
    6: piece6(ctx),
    7: piece7(ctx),
    11: piece11(ctx),
    14: piece14(ctx),
    17: piece17(ctx),
  };
}
