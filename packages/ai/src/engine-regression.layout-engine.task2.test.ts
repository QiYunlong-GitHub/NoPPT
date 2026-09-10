import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '@noppt/core';

// T2-TR1: 水平双栏（图左文右、内容列内含 UL）不应触发「单列列表→双列 Grid」
const HORIZONTAL_LEFT_HTML = `
<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;">
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;color:#ea580c;">信风减弱引发海温异常</h2>
  <div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;">
    <div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;overflow:hidden;border-radius:16px;">
      <img src="a.png" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;">
    </div>
    <div style="flex:0 0 55%;display:flex;flex-direction:column;gap:0;min-height:0;justify-content:space-evenly;">
      <ul style="margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;flex:1;min-height:0;">
        <li style="display:flex;align-items:center;gap:16px;padding:24px;border-radius:16px;">
          <span style="width:40px;height:40px;border-radius:12px;">I</span>
          <span style="font-size:19px;font-weight:600;color:#111;line-height:1.5;flex:1;">赤道东风信风周期性减弱，导致暖水向东太平洋回流</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;padding:24px;border-radius:16px;">
          <span style="width:40px;height:40px;border-radius:12px;">I</span>
          <span style="font-size:19px;font-weight:600;color:#111;line-height:1.5;flex:1;">表层海水温度较常年偏高0.5℃以上，持续数月甚至数年</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;padding:24px;border-radius:16px;">
          <span style="width:40px;height:40px;border-radius:12px;">I</span>
          <span style="font-size:19px;font-weight:600;color:#111;line-height:1.5;flex:1;">海洋热量释放改变大气环流，打破沃克环流原有平衡</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;padding:24px;border-radius:16px;">
          <span style="width:40px;height:40px;border-radius:12px;">I</span>
          <span style="font-size:19px;font-weight:600;color:#111;line-height:1.5;flex:1;">海气相互作用形成正反馈机制，加剧气候系统不稳定性</span>
        </li>
      </ul>
    </div>
  </div>
</div>`;

// T2-TR3: 垂直 TOP（真实的上图下文，H2 -> 图片包裹 -> 单列长列表）必须触发双列（≥4 li）
const VERTICAL_TOP_4LI = `
<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;">
  <h2 style="font-size:40px;margin:0 0 32px 0;">气候变化影响</h2>
  <div style="flex:0 0 40%;"><img src="a.png" style="width:100%;height:100%;object-fit:cover;"></div>
  <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:24px;flex:1;">
    <li><span>A</span></li><li><span>B</span></li><li><span>C</span></li><li><span>D</span></li>
  </ul>
</div>`;

describe('Task 2: 双栏 slide 不被误判为垂直布局 → 双列', () => {

  it('T2-TR1: 水平双栏（图左文右）UL 保持 flex-direction:column 单列', () => {
    const out = LayoutEngine.normalizeAISlide({ index: 0, html: HORIZONTAL_LEFT_HTML } as any);
    const ulMatch = out.html.match(/<ul\b([^>]*)>/i);
    expect(ulMatch).toBeTruthy();
    const style = ulMatch![1].match(/style="([^"]*)"/i)?.[1] ?? '';
    // 不应出现 grid-template-columns:repeat(2,1fr)
    expect(style).not.toMatch(/grid-template-columns\s*:\s*repeat\s*\(\s*2\s*,/i);
    // 必须仍是 column（单列）
    expect(style).toMatch(/flex-direction\s*:\s*column|display\s*:\s*flex/i);
  });

  it('T2-TR3: 垂直 TOP ≥4 li → UL 双列 grid 启动（高度压缩仍需）', () => {
    const out = LayoutEngine.normalizeAISlide({ index: 0, html: VERTICAL_TOP_4LI } as any);
    const ulMatch = out.html.match(/<ul\b([^>]*)>/i);
    expect(ulMatch).toBeTruthy();
    const style = ulMatch![1].match(/style="([^"]*)"/i)?.[1] ?? '';
    expect(style).toMatch(/grid-template-columns\s*:\s*repeat\s*\(\s*2\s*,/i);
  });
});
