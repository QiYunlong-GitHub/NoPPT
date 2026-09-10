import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HTMLPresentationAgent } from './html-presentation-agent';
import { resolveColorPolicyForPage } from '../utils/reference-attribute-resolver';
import { styleViolationSignal } from '../utils/style-violation-signal';
import { isCoverLikeHtml } from '@noppt/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 极简可空 stub contentProvider，仅用于实例化 agent（测试不触发真实 LLM 调用）。 */
function buildAgent(): HTMLPresentationAgent {
  const dummy = {
    name: 'stub',
    config: {},
    supportsStreaming: false,
    chat: async () => ({
      content: '',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  } as any;
  return new HTMLPresentationAgent(dummy);
}

/** 与真实用例 pres_mtr3es5u_ju99pb9 同款的 cover 参考视觉属性 */
function buildCoverRefAttrs(): any {
  const palette = {
    accents: ['#073b4c', '#06d6a0', '#118ab2', '#ffc93c'],
    strokeColor: '#073b4c',
    isMultiColor: true,
  };
  const cat = {
    uploaded: true,
    primaryColor: '#ff4d6d',
    style: { titleColor: '#22223b', bodyColor: '#5c5c72', primaryColor: '#ff4d6d' },
    palette,
  };
  return {
    byCategory: {
      cover: cat,
      content: { uploaded: false, style: {}, palette: undefined, primaryColor: '#27ae60' },
      summary: { uploaded: false, style: {}, palette: undefined, primaryColor: '#f4a261' },
    },
    global: { uploaded: false, style: {}, palette: undefined, primaryColor: '#ff4d6d' },
  } as any;
}

/** 受控封面 HTML：标题色 #22223b + 参考撞色板 + 裸文本 kicker + 图片占位符（与真实
 *  cover 同构：含 <img> 占位符会使 enforceCoverPosterArtStyles 跳过，避免封面艺术字特征
 *  改写标题/副标题，从而精准验证「参考撞色板保真」这一修复点）。 */
const CONTROLLED_COVER = `<div style="width:100%;height:100%;display:flex;flex-direction:column;">
  <h1 style="font-size:88px;color:#22223b;">厄尔尼诺现象</h1>
  <div style="font-size:16px;color:#118ab2;letter-spacing:0.05em;">CLIMATE SCIENCE · 2026</div>
  <div style="background:#073b4c10;width:200px;height:200px;"></div>
  <div style="background:linear-gradient(135deg,#06d6a0,transparent);width:100px;height:100px;"></div>
  <p style="color:#5c5c72;">正文说明一段</p>
  <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;">
</div>`;

describe('参考撞色板保真（P1）：后处理不得把参考风格压成主色系', () => {
  it('resolveColorPolicyForPage 按页解析出参考标题色与撞色板', () => {
    const cp = resolveColorPolicyForPage(buildCoverRefAttrs(), 'cover', '#ff4d6d', '#cc3e57');
    expect(cp.titleColor).toBe('#22223b');
    expect(cp.bodyColor).toBe('#5c5c72');
    expect(cp.isMultiColor).toBe(true);
    expect(cp.accents).toEqual(['#073b4c', '#06d6a0', '#118ab2', '#ffc93c']);
    expect(cp.strokeColor).toBe('#073b4c');
  });

  it('postProcessHtmlSnapshot 保留参考标题色（不粉化、不压成 #111827）', () => {
    const agent = buildAgent();
    const out = agent.postProcessHtmlSnapshot(CONTROLLED_COVER, {
      primaryColor: '#ff4d6d',
      primaryColorDarker: '#cc3e57',
      pageType: 'cover',
      referenceVisualAttributes: buildCoverRefAttrs(),
    });
    expect(out).toMatch(/<h1[^>]*style="[^"]*color:\s*#22223b/i);
    expect(out).not.toMatch(/<h1[^>]*style="[^"]*color:\s*#ff4d6d/i);
    expect(out).not.toMatch(/<h1[^>]*style="[^"]*color:\s*#111827/i);
  });

  it('postProcessHtmlSnapshot 保留参考撞色板（渐变/装饰背景不被归一成主色）', () => {
    const agent = buildAgent();
    const out = agent.postProcessHtmlSnapshot(CONTROLLED_COVER, {
      primaryColor: '#ff4d6d',
      primaryColorDarker: '#cc3e57',
      pageType: 'cover',
      referenceVisualAttributes: buildCoverRefAttrs(),
    });
    const low = out.toLowerCase();
    // 撞色任一保留即可证明未被"单色系红线"重写
    expect(low).toMatch(/#073b4c|#06d6a0|#118ab2|#ffc93c/);
    // 渐变里的 #06d6a0 不应被替换成主色 #ff4d6d
    expect(low).toContain('#06d6a0');
    expect(low).not.toMatch(/linear-gradient\(135deg,\s*#ff4d6d,\s*#cc3e57\)/);
  });

  it('裸文本 kicker 继承父容器排版（16px / 参考色 / 字距），不被写死 #374151', () => {
    const agent = buildAgent();
    const out = agent.postProcessHtmlSnapshot(CONTROLLED_COVER, {
      primaryColor: '#ff4d6d',
      primaryColorDarker: '#cc3e57',
      pageType: 'cover',
      referenceVisualAttributes: buildCoverRefAttrs(),
    });
    // kicker 被包成 <p>，其 style 应继承 color:#118ab2 与 font-size:16px，而非落到 #374151
    expect(out).toMatch(/<p[^>]*style="[^"]*color:\s*#118ab2/i);
    expect(out).toMatch(/<p[^>]*style="[^"]*font-size:\s*16px/i);
    expect(out).not.toMatch(/<p[^>]*style="[^"]*color:\s*#374151/i);
  });
});

describe('真实封面样例回归（pres_mtr3es5u_ju99pb9 / 05-content1-response.html）', () => {
  const fixture = resolve(
    __dirname,
    '../../../../scripts/output/pres_mtr3es5u_ju99pb9/05-content1-response.html',
  );
  it('参考标题色与撞色板在真实大模型输出后处理后被保留', () => {
    let coverHtml: string;
    try {
      coverHtml = readFileSync(fixture, 'utf-8');
    } catch {
      // 样例不存在时跳过，避免 CI 缺文件失败
      return;
    }
    const agent = buildAgent();
    const out = agent.postProcessHtmlSnapshot(coverHtml, {
      primaryColor: '#ff4d6d',
      primaryColorDarker: '#cc3e57',
      pageType: 'cover',
      referenceVisualAttributes: buildCoverRefAttrs(),
    });
    // H1 标题色保持参考值（低饱和深蓝紫），未被主色粉化
    expect(out.toLowerCase()).toMatch(/color:\s*#22223b/);
    // 参考撞色板至少一种被保留
    expect(out.toLowerCase()).toMatch(/#073b4c|#06d6a0|#118ab2|#ffc93c/);
  });
});

describe('居中护栏单一真源（P2）：isCoverLikeHtml', () => {
  it('多列/分栏结构判为非封面（含 flex:0 0 40% 空图片列场景），禁止强制居中', () => {
    const multicol = `<div style="display:flex;flex-direction:row;">
      <div style="flex:1;"><h1 style="font-size:80px;">Title</h1><p>sub</p></div>
      <div style="flex:0 0 40%;"></div>
    </div>`;
    expect(isCoverLikeHtml(multicol)).toBe(false);
  });

  it('纯标题封面判为封面式，可注入居中', () => {
    const pure = `<div style="width:100%;height:100%;display:flex;flex-direction:column;"><h1 style="font-size:80px;">Title</h1></div>`;
    expect(isCoverLikeHtml(pure)).toBe(true);
  });

  it('含 h2 / 列表 / img / table 的内容页判为非封面', () => {
    expect(isCoverLikeHtml(`<div><h2>t</h2></div>`)).toBe(false);
    expect(isCoverLikeHtml(`<div><ul><li>a</li></ul></div>`)).toBe(false);
    expect(isCoverLikeHtml(`<div><img src="x"></div>`)).toBe(false);
    expect(isCoverLikeHtml(`<div><table><tr><td>a</td></tr></table></div>`)).toBe(false);
  });
});

describe('终局越权信号白名单（P1）：参考撞色不计入越权', () => {
  it('传入 allowedAccentHexes 后，参考撞色不再被计为 colorViolations', () => {
    const html =
      '<div style="color:#073b4c;"></div><div style="color:#06d6a0;"></div><div style="color:#ff4d6d;"></div>';
    const without = styleViolationSignal(html, '#ff4d6d');
    const withAccents = styleViolationSignal(html, '#ff4d6d', {
      allowedAccentHexes: new Set(['#073b4c', '#06d6a0']),
    });
    expect(without.colorViolations).toBeGreaterThan(withAccents.colorViolations);
    expect(withAccents.colorViolations).toBe(0);
  });
});
