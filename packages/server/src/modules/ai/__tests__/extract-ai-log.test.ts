import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// 端到端验证 extract-ai-log.js 对新增的 finalize-deck 环节报文的正确抽取。
// 通过 NOPPT_PRES_DIR 将输入目录重定向到临时目录，避免污染仓库数据目录。
const SCRIPT = path.resolve(__dirname, '../../../../../../scripts/extract-ai-log.js');
const PRES_ID = 'test-deck-extract';

describe('extract-ai-log: finalize-deck 抽取', () => {
  let tmp: string;
  let presParent: string;
  let outDir: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noppt-deck-extract-'));
    presParent = path.join(tmp, 'presentations');
    const presDir = path.join(presParent, PRES_ID);
    fs.mkdirSync(presDir, { recursive: true });
    outDir = path.join(tmp, 'out');

    const deckSlide = {
      id: 'slide-0',
      title: 'S1',
      nodes: [
        {
          kind: 'text',
          rect: { x: 0, y: 0, w: 100, h: 50 },
          paragraphs: [{ runs: [{ text: 'Hello' }] }],
        },
        {
          kind: 'image',
          rect: { x: 100, y: 100, w: 200, h: 120 },
          src: 'deck:placeholder',
          alt: '占位图',
        },
      ],
    };
    const log = [
      {
        type: 'generate-presentation',
        ts: Date.now(),
        id: PRES_ID,
        title: 'T',
        design: { primaryColor: '#999999' },
        routing: {},
        referenceFiles: [],
        slides: [
          {
            id: 's1',
            title: 'S1',
            pageType: 'content',
            html: '<div style="position:relative;width:1280px;height:720px;">hi</div>',
          },
        ],
        response: { slides: [{ id: 's1', html: '<div>hi</div>' }] },
      },
      {
        type: 'finalize-deck',
        ts: Date.now(),
        slideCount: 1,
        deckedSlides: 1,
        totalNodes: 2,
        perSlideNodeCount: [2],
        fallbackEmptyNodeSlides: 0,
        deck: [deckSlide],
      },
    ];
    fs.writeFileSync(
      path.join(presDir, 'ai-log.jsonl'),
      log.map((l) => JSON.stringify(l)).join('\n'),
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('抽取 finalize-deck 生成 08-deck-overview.md 与逐页节点树 JSON', () => {
    execFileSync('node', [SCRIPT, PRES_ID, '--out', outDir, '--only', 'deck'], {
      env: { ...process.env, NOPPT_PRES_DIR: presParent },
      encoding: 'utf8',
    });

    const overview = path.join(outDir, PRES_ID, '08-deck-overview.md');
    expect(fs.existsSync(overview)).toBe(true);
    const md = fs.readFileSync(overview, 'utf8');
    expect(md).toContain('结构化 Deck 节点树');
    expect(md).toContain('总节点数');
    expect(md).toContain('节点类型分布');

    const slideJson = path.join(outDir, PRES_ID, '08-deck', 'slide01.json');
    expect(fs.existsSync(slideJson)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(slideJson, 'utf8'));
    expect(parsed.nodes).toHaveLength(2);
  });

  it('简单模式（无 deck 大字段）也生成 overview 且不导出逐页 JSON', () => {
    const presId2 = 'test-deck-extract-simple';
    const presDir2 = path.join(presParent, presId2);
    fs.mkdirSync(presDir2, { recursive: true });
    const log = [
      {
        type: 'generate-presentation',
        ts: Date.now(),
        id: presId2,
        title: 'T',
        design: { primaryColor: '#999999' },
        routing: {},
        referenceFiles: [],
        slides: [{ id: 's1', title: 'S1', pageType: 'content', html: '<div>hi</div>' }],
        response: { slides: [{ id: 's1', html: '<div>hi</div>' }] },
      },
      {
        type: 'finalize-deck',
        ts: Date.now(),
        slideCount: 1,
        deckedSlides: 1,
        totalNodes: 1,
        perSlideNodeCount: [1],
        fallbackEmptyNodeSlides: 0,
        // 简单模式不附 deck
      },
    ];
    fs.writeFileSync(
      path.join(presDir2, 'ai-log.jsonl'),
      log.map((l) => JSON.stringify(l)).join('\n'),
      'utf8',
    );

    const out2 = path.join(tmp, 'out-simple');
    execFileSync('node', [SCRIPT, presId2, '--out', out2, '--only', 'deck'], {
      env: { ...process.env, NOPPT_PRES_DIR: presParent },
      encoding: 'utf8',
    });

    const overview = path.join(out2, presId2, '08-deck-overview.md');
    expect(fs.existsSync(overview)).toBe(true);
    const slideJson = path.join(out2, presId2, '08-deck', 'slide01.json');
    expect(fs.existsSync(slideJson)).toBe(false);
  });
});
