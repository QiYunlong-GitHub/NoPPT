import { extractReferenceImageAttributes, VlmTextProvider } from './vlm-attribute-extraction';

function mockProvider(returnText: string): VlmTextProvider {
  return { generateText: async () => returnText };
}

describe('Task3 · extractReferenceImageAttributes (TR-3.x)', () => {
  it('L1 合法 JSON 解析为 CategoryReference（结构性 3 字段强制 undefined）', async () => {
    const json = JSON.stringify({
      confidence: 0.9,
      primaryColor: '#ea580c',
      fontFamily: 'serif',
      contentDensity: 'compact',
      iconStyle: 'numbered',
      style: 'creative',
      // 以下 3 项为结构性字段，图片参考永远不推断（FR-2）
      imagePreference: 'all',
      slideCount: 6,
      pageHints: { disableCover: true, disableToc: false, disableConclusion: false },
      backgroundEnabled: true,
      master: { logo: { position: 'top-right', colorHex: '#dc2626' }, footer: { textContent: 'NoPPT', hasPageNumber: true } },
      layout: { type: 'single', single: 'card-grid', pageTypeMap: null },
    });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBe('#ea580c');
    expect(r.style.fontFamily).toBe('serif');
    expect(r.style.contentDensity).toBe('compact');
    expect(r.style.iconStyle).toBe('numbered');
    expect(r.style.style).toBe('creative');
    expect(r.style.backgroundEnabled).toBe(true);
    // FR-2：图片参考强制丢弃结构性 3 属性
    expect(r.style.imagePreference).toBeUndefined();
    expect(r.style.slideCount).toBeUndefined();
    expect(r.style.pageHints).toBeUndefined();
    expect(r.master!.logo!.position).toBe('top-right');
    expect(r.master!.logo!.colorHex).toBe('#dc2626');
    expect(r.master!.footer!.textContent).toBe('NoPPT');
    expect(r.master!.footer!.hasPageNumber).toBe(true);
    expect(r.layout!.type).toBe('single');
    expect(r.layout!.single).toBe('card-grid');
  });

  it('[TXT] 文字色：titleColor/bodyColor 解析，允许近黑（不被主色排除逻辑过滤）', async () => {
    const json = JSON.stringify({
      confidence: 0.9,
      primaryColor: '#ea580c',
      titleColor: '#111827',
      bodyColor: '#1a1a1a',
    });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.style.titleColor).toBe('#111827');
    expect(r.style.bodyColor).toBe('#1a1a1a');
  });

  it('[TXT] 文字色非法 hex（如 "black"）被忽略 → 回落 undefined', async () => {
    const json = JSON.stringify({ confidence: 0.9, primaryColor: '#ea580c', titleColor: 'black', bodyColor: '#12' });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.style.titleColor).toBeUndefined();
    expect(r.style.bodyColor).toBeUndefined();
  });

  it('[TXT] 文字色字段缺失（JSON 不含 titleColor/bodyColor）→ 回落 undefined', async () => {
    const json = JSON.stringify({ confidence: 0.9, primaryColor: '#ea580c' });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.style.titleColor).toBeUndefined();
    expect(r.style.bodyColor).toBeUndefined();
  });

  it('L2 含噪声/Markdown 代码块仍可抠出 JSON', async () => {
    const noisy = '```json\n' + JSON.stringify({ primaryColor: '#2563eb', fontFamily: 'sans' }) + '\n```\n（说明文字）';
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(noisy));
    expect(r.style.primaryColor).toBe('#2563eb');
    expect(r.style.fontFamily).toBe('sans');
  });

  it('L3/L4 非法 JSON → minimal（仅 uploaded 标记）', async () => {
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider('这不是 JSON'));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBeUndefined();
    expect(Object.keys(r.style).length).toBe(0);
  });

  it('L5 vlmProvider 抛错 → minimal', async () => {
    const failing: VlmTextProvider = { generateText: async () => { throw new Error('VLM down'); } };
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', failing);
    expect(r.uploaded).toBe(true);
    expect(Object.keys(r.style).length).toBe(0);
  });

  it('非法枚举值被忽略（primaryColor 非 hex / style 非允许值）', async () => {
    const json = JSON.stringify({ primaryColor: 'red', style: 'unknown-style', iconStyle: 'star' });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.style.primaryColor).toBeUndefined();
    expect(r.style.style).toBeUndefined();
    expect(r.style.iconStyle).toBeUndefined();
  });

  it('confidence < 0.5 → 整次提取降级为 minimal', async () => {
    const json = JSON.stringify({
      confidence: 0.2,
      primaryColor: '#ea580c',
      master: { logo: { position: 'top-right', colorHex: '#dc2626' } },
    });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.uploaded).toBe(true);
    expect(Object.keys(r.style).length).toBe(0);
    expect(r.master).toBeUndefined();
  });

  it('confidence 缺失 → 不触发降级（向后兼容）', async () => {
    const json = JSON.stringify({ primaryColor: '#2563eb', fontFamily: 'mono' });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.style.primaryColor).toBe('#2563eb');
    expect(r.style.fontFamily).toBe('mono');
  });

  it('母版四类元素 + LOGO 归一化 bbox 解析', async () => {
    const json = JSON.stringify({
      confidence: 0.9,
      master: {
        logo: { position: 'top-left', x: 0.02, y: 0.03, w: 0.12, h: 0.1, colorHex: '#dc2626', description: '红色方标', confidence: 0.8 },
        header: { elements: [{ type: 'title-bar', colorHex: '#2563eb' }] },
        footer: { textContent: 'NoPPT', hasPageNumber: true },
        sideDecorations: [{ side: 'right', colorHex: '#16a34a' }, { side: 'bad', colorHex: '#000000' }],
      },
    });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.master!.logo!.x).toBe(0.02);
    expect(r.master!.logo!.y).toBe(0.03);
    expect(r.master!.logo!.w).toBe(0.12);
    expect(r.master!.logo!.h).toBe(0.1);
    expect(r.master!.logo!.confidence).toBe(0.8);
    expect(r.master!.header!.elements![0]).toEqual({ type: 'title-bar', colorHex: '#2563eb' });
    expect(r.master!.sideDecorations!.length).toBe(2);
    expect(r.master!.sideDecorations![0]).toEqual({ side: 'right', colorHex: '#16a34a' });
    // side='bad' 非法 → 降级为 right
    expect(r.master!.sideDecorations![1].side).toBe('right');
  });

  it('LOGO confidence < 0.5 → LOGO 被丢弃（其他母版元素保留）', async () => {
    const json = JSON.stringify({
      confidence: 0.9,
      master: {
        logo: { position: 'top-left', colorHex: '#dc2626', confidence: 0.3 },
        footer: { textContent: 'NoPPT', hasPageNumber: true },
      },
    });
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', mockProvider(json));
    expect(r.master!.logo).toBeUndefined();
    expect(r.master!.footer!.textContent).toBe('NoPPT');
  });

  it('VLM 5s 超时 → 降级为 minimal', async () => {
    const hanging: VlmTextProvider = { generateText: () => new Promise<string>(() => { /* never resolves */ }) };
    const r = await extractReferenceImageAttributes('data:image/png;base64,xxx', hanging);
    expect(r.uploaded).toBe(true);
    expect(Object.keys(r.style).length).toBe(0);
  }, 8000);
});
