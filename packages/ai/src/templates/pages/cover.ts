import type { TemplateCtx } from './types';

const piece0 = (ctx: TemplateCtx): string => `### cover（封面页 · 海报级艺术字版本）
\`\`\`html
<div style="${ctx.OUTER};justify-content:center;align-items:center;text-align:center;overflow:hidden;">
  <!-- 装饰渐变形状1：右上角光晕椭圆 -->
  <div style="position:absolute;top:-80px;right:-120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,${ctx.P}35 0%,${ctx.P}10 45%,transparent 75%);pointer-events:none;"></div>
  <!-- 装饰渐变形状2：左下角渐变斜切 -->
  <div style="position:absolute;left:-160px;bottom:-120px;width:480px;height:400px;background:linear-gradient(135deg,${ctx.P}18,${ctx.PD}10);clip-path:polygon(0 30%,40% 0,80% 60%,30% 100%);pointer-events:none;"></div>
  <!-- 装饰细线：左侧渐变竖线 -->
  <div style="position:absolute;left:80px;top:20%;bottom:20%;width:3px;background:linear-gradient(180deg,transparent,${ctx.P},transparent);border-radius:2px;pointer-events:none;"></div>
  <!-- 加粗渐变装饰下划线/分隔线（在标题下方） -->
  <h1 style="${ctx.GRAD_H1}">主标题文字</h1>
  <div style="width:180px;height:8px;background:linear-gradient(90deg,${ctx.P},${ctx.PD});border-radius:4px;margin:0 0 32px 0;box-shadow:0 4px 20px ${ctx.P}45;"></div>
  <!-- 副标题分层：第1行加粗+主色渐变，第2~3行深灰，最后胶囊badge -->
  <p style="font-size:32px;font-weight:700;line-height:1.4;margin:0 0 16px 0;overflow-wrap:break-word;word-break:break-word;${ctx.GRAD_TEXT.replace(/background:linear/, 'background:linear').slice(0, -1)};">副标题·核心定位（加粗渐变大字）</p>
  <p style="font-size:24px;color:#1F2937;font-weight:600;margin:0 0 8px 0;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">副标题第二行·亮点描述</p>
  <p style="font-size:24px;color:#1F2937;font-weight:600;margin:0 0 32px 0;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">副标题第三行·延伸信息</p>
  <!-- 胶囊 badge -->
  <div style="display:inline-flex;align-items:center;padding:8px 24px;border-radius:999px;background:${ctx.P}12;color:${ctx.P};font-size:18px;font-weight:600;letter-spacing:0.02em;box-shadow:0 2px 8px ${ctx.P}20;overflow-wrap:break-word;word-break:break-word;">作者 / 公司 / 出品信息</div>
</div>
\`\`\`
`;

const piece1 = (ctx: TemplateCtx): string => `### cover-left（封面页 · 左对齐构图版本 · 当参考为左对齐构图时使用）
**当上方「参考版式结构指引 / 覆盖指令」标注左对齐构图时，使用本模板而非上面的居中封面；内容列左对齐、垂直居中，禁止居中三件套。**
\`\`\`html
<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${ctx.PY}px ${ctx.PX}px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;background-color:{{CANVAS_BG_COLOR}};font-family:${ctx.FONT_STACK_ACTIVE}">
  <!-- 装饰：左上角几何色块（参考孟菲斯撞色风格） -->
  <div style="position:absolute;top:48px;left:48px;width:120px;height:120px;background:linear-gradient(135deg,${ctx.P},${ctx.PD});border-radius:24px;transform:rotate(12deg);opacity:0.9;pointer-events:none;"></div>
  <div style="position:absolute;bottom:-60px;right:-60px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,${ctx.P}30 0%,${ctx.P}10 45%,transparent 75%);pointer-events:none;"></div>
  <!-- 内容列左对齐，占 ~58% 宽 -->
  <div style="position:relative;max-width:58%;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:24px;">
    <h1 style="font-size:80px;font-weight:900;line-height:1.1;margin:0;letter-spacing:-0.01em;color:{{TITLE_TEXT_COLOR}};overflow-wrap:break-word;word-break:break-word;">主标题文字</h1>
    <div style="width:160px;height:8px;background:linear-gradient(90deg,${ctx.P},${ctx.PD});border-radius:4px;box-shadow:0 4px 20px ${ctx.P}45;"></div>
    <p style="font-size:28px;font-weight:700;line-height:1.4;margin:0;color:{{TITLE_TEXT_COLOR}};overflow-wrap:break-word;word-break:break-word;">核心定位副标题</p>
    <p style="font-size:22px;color:#5c5c72;font-weight:600;margin:0;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">延伸说明副标题</p>
    <div style="display:inline-flex;align-items:center;padding:8px 24px;border-radius:999px;background:${ctx.P}12;color:${ctx.P};font-size:18px;font-weight:600;letter-spacing:0.02em;box-shadow:0 2px 8px ${ctx.P}20;">作者 / 公司 / 出品信息</div>
  </div>
</div>
\`\`\`
`;

export function buildCoverSections(ctx: TemplateCtx): Record<number, string> {
  return {
    0: piece0(ctx),
    1: piece1(ctx),
  };
}
