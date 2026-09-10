import { describe, it, expect, vi, afterEach } from 'vitest';
import { QwenImageProvider } from './qwen-image';

describe('QwenImageProvider img2img seed by category (FR-15)', () => {
  const provider = new QwenImageProvider({ apiKey: 'test-key', model: 'qwen-image-2.0-pro' });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('优先使用分类参考图，否则回退 global，再回退旧字段 referenceImage', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Response(
        JSON.stringify({
          output: { choices: [{ message: { content: [{ image: 'data:image/png;base64,AAA' }] } }] },
        }),
        { status: 200 },
      );
    });

    // 1) cover slide + 分类 map（含 cover 专属）→ 选 cover.png
    await provider.generateImage('prompt', {
      size: '1024x1024',
      referenceImage: 'legacy.png',
      referenceImageByCategory: { cover: 'cover.png', global: 'global.png' },
      referenceCategory: 'cover',
    });
    const c1 = calls[0].input.messages[0].content;
    expect(c1.some((c: any) => c.image === 'cover.png')).toBe(true);

    // 2) content slide 无 content 专属 → 回退 global.png
    await provider.generateImage('prompt', {
      size: '1024x1024',
      referenceImage: 'legacy.png',
      referenceImageByCategory: { global: 'global.png' },
      referenceCategory: 'content',
    });
    const c2 = calls[1].input.messages[0].content;
    expect(c2.some((c: any) => c.image === 'global.png')).toBe(true);

    // 3) 无 map，仅旧字段 → 使用 legacy.png（逐字节兼容旧行为）
    await provider.generateImage('prompt', { size: '1024x1024', referenceImage: 'legacy.png' });
    const c3 = calls[2].input.messages[0].content;
    expect(c3.some((c: any) => c.image === 'legacy.png')).toBe(true);

    // 4) 完全无 seed → 不注入任何 image（纯文生图）
    await provider.generateImage('prompt', { size: '1024x1024' });
    const c4 = calls[3].input.messages[0].content;
    expect(c4.some((c: any) => c.image)).toBe(false);
  });
});
