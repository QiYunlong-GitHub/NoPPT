import { extractReferenceHtmlAttributes } from './reference-html-extractor';

// 构造最小 slide HTML 的辅助
function slide(pageType: string, inner: string, extraClass = ''): string {
  return `<div class="slide ${extraClass}" data-page-type="${pageType}" data-slide-index="0">${inner}</div>`;
}

describe('Task2 · extractReferenceHtmlAttributes 9 风格 (TR-2.1~2.11)', () => {
  it('TR-2.1 主色：#ea580c 高频胜出，近黑/白/灰不计数', () => {
    const html = `
      <div style="color:#ea580c"></div><div style="color:#ea580c"></div><div style="color:#ea580c"></div>
      <div style="color:#000000"></div><div style="color:#ffffff"></div><div style="background:#cccccc"></div>`;
    const r = extractReferenceHtmlAttributes(html);
    expect(r.style.primaryColor).toBe('#ea580c');
    expect(r.uploaded).toBe(true);
  });

  it('TR-2.x 标题/正文文字色：h1/h2/h3 与 li/p 显式 color 被提取，近黑不被排除', () => {
    const html = `
      <div class="slide">
        <h1 style="color:#111827">标题</h1>
        <h2 style="color:#111827">副标题</h2>
        <ul><li style="color:#333333">正文一</li><li style="color:#333333">正文二</li></ul>
      </div>`;
    const r = extractReferenceHtmlAttributes(html);
    expect(r.style.titleColor).toBe('#111827');
    expect(r.style.bodyColor).toBe('#333333');
  });

  it('TR-2.x 标题/正文无显式 color → undefined（不误用背景/容器色）', () => {
    const html = `
      <div class="slide" style="background:#0f172a;color:#ffffff">
        <h1>标题</h1>
        <p>正文</p>
      </div>`;
    const r = extractReferenceHtmlAttributes(html);
    expect(r.style.titleColor).toBeUndefined();
    expect(r.style.bodyColor).toBeUndefined();
  });

  it('TR-2.2 字体提取', () => {
    expect(
      extractReferenceHtmlAttributes(`<p style="font-family: Serif">a</p>`).style.fontFamily,
    ).toBe('serif');
    expect(
      extractReferenceHtmlAttributes(`<p style="font-family: 'Courier New', monospace">a</p>`).style
        .fontFamily,
    ).toBe('mono');
    expect(
      extractReferenceHtmlAttributes(`<p style="font-family: Arial, sans-serif">a</p>`).style
        .fontFamily,
    ).toBe('sans');
  });

  it('TR-2.3 图标映射 5 种 → numbered/numbered/lettered/bullet/line', () => {
    expect(
      extractReferenceHtmlAttributes(`<span class="number-circle">1</span>`).style.iconStyle,
    ).toBe('numbered');
    expect(
      extractReferenceHtmlAttributes(`<span class="large-number">9</span>`).style.iconStyle,
    ).toBe('numbered');
    expect(
      extractReferenceHtmlAttributes(`<span class="letter-circle">A</span>`).style.iconStyle,
    ).toBe('lettered');
    expect(extractReferenceHtmlAttributes(`<span class="icon dot"></span>`).style.iconStyle).toBe(
      'bullet',
    );
    expect(extractReferenceHtmlAttributes(`<svg viewBox="0 0 10 10"></svg>`).style.iconStyle).toBe(
      'line',
    );
  });

  it('TR-2.4 密度打分', () => {
    const compact = `<ul>${'<li style="padding:24px;font-size:17px">x</li>'.repeat(6)}</ul>`;
    expect(extractReferenceHtmlAttributes(compact).style.contentDensity).toBe('compact');
    const spacious = `<ul>${'<li style="padding:64px;font-size:20px">x</li>'.repeat(2)}</ul>`;
    expect(extractReferenceHtmlAttributes(spacious).style.contentDensity).toBe('spacious');
    expect(
      extractReferenceHtmlAttributes(`<ul><li style="padding:40px;font-size:18px">x</li></ul>`)
        .style.contentDensity,
    ).toBe('normal');
  });

  it('TR-2.5 配图分布', () => {
    expect(
      extractReferenceHtmlAttributes(`<img src="a"><img src="b"><img src="c">`).style
        .imagePreference,
    ).toBe('all');
    expect(extractReferenceHtmlAttributes(`<img src="a">`).style.imagePreference).toBe('minimal');
    expect(extractReferenceHtmlAttributes(`<p>no img</p>`).style.imagePreference).toBe('none');
  });

  it('TR-2.6 风格推断', () => {
    const creative = `<div style="color:#7c3aed;background:linear-gradient(...)"></div>`;
    expect(extractReferenceHtmlAttributes(creative).style.style).toBe('creative');
    const academic = `<div style="color:#2563eb"></div><p style="font-family: serif">x</p>`;
    expect(extractReferenceHtmlAttributes(academic).style.style).toBe('academic');
    const business = `<div style="color:#2563eb"></div><p style="font-family: sans-serif">x</p>`;
    expect(extractReferenceHtmlAttributes(business).style.style).toBe('business');
  });

  it('TR-2.7 背景开关', () => {
    expect(
      extractReferenceHtmlAttributes(`<div style="background-image:url(x.png)"></div>`).style
        .backgroundEnabled,
    ).toBe(true);
    expect(extractReferenceHtmlAttributes(`<div>plain</div>`).style.backgroundEnabled).toBe(false);
  });

  it('TR-2.8 pageHints：size>=4 三禁用；size=1 undefined', () => {
    const multi = `<div data-page-type="cover"></div><div data-page-type="toc"></div><div data-page-type="content-cards"></div><div data-page-type="summary"></div>`;
    expect(extractReferenceHtmlAttributes(multi).style.pageHints).toEqual({
      disableCover: true,
      disableToc: true,
      disableConclusion: true,
    });
    const single = `<div data-page-type="content-cards"></div>`;
    expect(extractReferenceHtmlAttributes(single).style.pageHints).toBeUndefined();
  });

  it('TR-2.9 slideCount 首选 data-slide-index', () => {
    const html = Array.from(
      { length: 5 },
      (_, i) => `<div class="slide" data-slide-index="${i}"></div>`,
    ).join('');
    expect(extractReferenceHtmlAttributes(html).style.slideCount).toBe(5);
  });

  it('TR-2.10 无 slide 容器且 pageType 单种 → undefined', () => {
    const html = `<div data-page-type="content-cards"></div>`;
    expect(extractReferenceHtmlAttributes(html).style.slideCount).toBeUndefined();
  });

  it('TR-2.11 pageTypeSet size>=3 → size', () => {
    const html = `<div data-page-type="cover"></div><div data-page-type="toc"></div><div data-page-type="content-cards"></div><div data-page-type="summary"></div>`;
    expect(extractReferenceHtmlAttributes(html).style.slideCount).toBe(4);
  });
});

describe('Task2 · 母版 C-13 (TR-2.14/2.15)', () => {
  const page = (i: number) =>
    `<div class="slide" data-slide-index="${i}">` +
    `<img class="logo top-left" src="logo.png" />` +
    `<hr style="border-bottom:2px solid #2563eb" />` +
    `<p class="footer-text">NoPPT ©2025 内部使用</p>` +
    `</div>`;
  const fivePages = Array.from({ length: 5 }, (_, i) => page(i)).join('');

  it('TR-2.14 母版 5 页聚类：logo.top-left + htmlSnippet + header 横线 #2563eb + footer', () => {
    const r = extractReferenceHtmlAttributes(fivePages);
    expect(r.master!.logo!.position).toBe('top-left');
    expect(r.master!.logo!.htmlSnippet).toContain('logo.png');
    expect(r.master!.header!.elements![0].type).toBe('horizontal-line');
    expect(r.master!.header!.elements![0].colorHex).toBe('#2563eb');
    expect(r.master!.footer!.textContent).toContain('NoPPT ©2025');
  });

  it('TR-2.15 页码正则', () => {
    const html = `<div class="slide"><p>第 3 页 / 共 5 页</p></div>`;
    const r = extractReferenceHtmlAttributes(html);
    expect(r.master!.footer!.hasPageNumber).toBe(true);
  });
});

describe('Task2 · 布局 C-14 (TR-2.16/2.17/2.18)', () => {
  it('TR-2.17 table 权重', () => {
    const html = slide('content-cards', `<table style="width:70%"></table><p>x</p><p>y</p>`);
    expect(extractReferenceHtmlAttributes(html).layout!.single).toBe('table-dominant');
  });
  it('TR-2.18 flowchart 权重', () => {
    const html = slide('content-cards', `<svg class="flowchart-arrow"></svg>`);
    expect(extractReferenceHtmlAttributes(html).layout!.single).toBe('flowchart');
  });
  it('TR-2.16 pageTypeMap 聚合', () => {
    const html =
      slide('cover', `<div class="three-section"></div>`) +
      slide('toc', `<table></table>`) +
      slide('content-cards', `<div class="comparison"></div>`, 'comparison') +
      slide('content-cards', `<div class="comparison"></div>`, 'comparison') +
      slide('content-cards', `<svg class="flowchart"></svg>`) +
      slide('summary', `<div class="pyramid"></div>`);
    const r = extractReferenceHtmlAttributes(html);
    expect(r.layout!.type).toBe('page-type-map');
    expect(r.layout!.pageTypeMap!['cover']).toBe('three-section');
    expect(r.layout!.pageTypeMap!['toc']).toBe('table-dominant');
    expect(r.layout!.pageTypeMap!['content-cards']).toBe('comparison');
    expect(r.layout!.pageTypeMap!['summary']).toBe('pyramid');
  });
});

describe('Task2 · 分类隔离 (TR-2.19)', () => {
  it('三分类 HTML 分别调用互不串', () => {
    const cover = extractReferenceHtmlAttributes(
      `<div style="color:#16a34a"></div><p style="font-family:serif">a</p>`,
    );
    const content = extractReferenceHtmlAttributes(
      `<div style="color:#ea580c"></div><p style="font-family:sans-serif">a</p>`,
    );
    const summary = extractReferenceHtmlAttributes(
      `<div style="color:#2563eb"></div><p style="font-family:mono">a</p>`,
    );
    expect(cover.style.primaryColor).toBe('#16a34a');
    expect(content.style.primaryColor).toBe('#ea580c');
    expect(summary.style.primaryColor).toBe('#2563eb');
    expect(cover.uploaded && content.uploaded && summary.uploaded).toBe(true);
  });
});

describe('enhance · <style>/class/CSS 变量提取 (enhance-html-extractor)', () => {
  it('class 定义的 background-color 被提取为主色（不再只认内联）', () => {
    const html = `<style>.brand{background-color:#ff4d6d;}</style><div class="brand">x</div>`;
    expect(extractReferenceHtmlAttributes(html).style.primaryColor).toBe('#ff4d6d');
  });
  it('var(--primary) 经级联解析后提取为主色', () => {
    const html = `<style>:root{--primary:#ff4d6d;}.brand{background-color:var(--primary);}</style><div class="brand">x</div>`;
    expect(extractReferenceHtmlAttributes(html).style.primaryColor).toBe('#ff4d6d');
  });
  it('class 定义的 font-family 被提取', () => {
    const html = `<style>.serif-text{font-family:Georgia,serif;}</style><p class="serif-text">x</p>`;
    expect(extractReferenceHtmlAttributes(html).style.fontFamily).toBe('serif');
  });
  it('class 定义的正文 color 被提取', () => {
    const html = `<style>.lead{color:#123456;}</style><p class="lead">t</p>`;
    expect(extractReferenceHtmlAttributes(html).style.bodyColor).toBe('#123456');
  });
});

describe('enhance · 视觉七维特征 (enhance-html-extractor)', () => {
  it('从 grid 容器推断栏数并产出 visual', () => {
    const html = `<div class="slide"><div class="grid" style="display:flex"><div class="card"></div><div class="card"></div><div class="card"></div></div></div>`;
    const r = extractReferenceHtmlAttributes(html);
    expect(r.visual).toBeDefined();
    expect(r.visual!.columns).toBeGreaterThanOrEqual(2);
    expect(r.visual!.cardRadius).toBe('none');
  });
});
