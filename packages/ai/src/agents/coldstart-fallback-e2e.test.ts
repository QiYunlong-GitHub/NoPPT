// ================================================================
// Task 7.6 + 7.7: Final Automated Equivalence Validation
//  T7.6 冷启动等价验证：3 rounds × N slides × 4 assertions (generateFallbackSlide)
//  T7.7 真实 slides re-process：pres_mtghmyor_ntvs95e 基线 + postProcess
// ================================================================
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';
import type { SlidePlan } from '../types';

type AnyAgent = HTMLPresentationAgent & Record<string, any>;

function makeAgent(): HTMLPresentationAgent {
  const dummy: AIModelProvider = {
    name: 'dummy',
    config: { apiKey: 'x', baseURL: 'x', model: 'x', embeddingModel: 'x' },
    async chat() {
      return { role: 'assistant', content: '' };
    },
    supportsStreaming: false,
  } as unknown as AIModelProvider;
  return new HTMLPresentationAgent(dummy);
}

// ================================================================
// 共享断言与工具
// ================================================================
const MONO_MARKERS = /JetBrains Mono|ui-monospace|Noto Sans Mono CJK SC|Cascadia Code/i;
const SANS_MARKERS = /system-ui\s*,\s*-apple-system|,\s*sans-serif$/i;
const PURPLE_MARKERS = /7c3aed|632ebe/i;
const BLACK_MARKERS = /(?:^|;|\s)color\s*:\s*(?:#111827|black)\b/i;

function getOuterStyle(html: string): string {
  // 匹配最外层第一个 <div ...>
  const m = html.match(/^<div([^>]*)>/i);
  if (!m) return '';
  const sm = m[1].match(/style="([^"]*)"/i);
  return sm ? sm[1] : '';
}

function getOuterFontFamily(html: string): string {
  const style = getOuterStyle(html);
  const m = style.match(/font-family\s*:\s*([^;]+)/i);
  return m ? m[1].trim() : '';
}

/** 提取 h1/h2 标签的 style 字符串（全部拼接，便于查找颜色） */
function getHeadingStyles(html: string): string {
  const out: string[] = [];
  const re = /<h([12])\b[^>]*style="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[2]);
  return out.join(';');
}

/** 判断三件套（jc / ai / ta）是否在最外层 style 中同时为 center */
function hasAllThreeCenters(html: string): boolean {
  const style = getOuterStyle(html);
  const jc = /justify-content\s*:\s*center\b/i.test(style);
  const ai = /align-items\s*:\s*center\b/i.test(style);
  const ta = /text-align\s*:\s*center\b/i.test(style);
  return jc && ai && ta;
}

/**
 * 对一段 slide content HTML 执行 4 条断言 (mono/颜色/三件套)。
 * 当 allowCover=true（封面）时，三件套同时 true 视为合法，不报错。
 */
function runFourAssertions(
  label: string,
  html: string,
  opts: { allowCover?: boolean } = {},
): {
  failures: string[];
  outerFontFamily: string;
  headingColorBlack: boolean;
  hasPurple: boolean;
  threeCenter: boolean;
} {
  const failures: string[] = [];
  const ff = getOuterFontFamily(html);
  const monoOk = MONO_MARKERS.test(ff);
  if (!monoOk)
    failures.push(
      `${label} [font-family] 期望 mono 栈(JetBrains Mono/Noto Sans Mono CJK SC/ui-monospace)，实际: "${ff}"`,
    );

  const hStyle = getHeadingStyles(html);
  // 黑色故障：h1/h2 style 中出现 color:#111827 或 color:black
  // 注意：不应与 background-clip / -webkit-text-fill-color 等非 color: 属性混淆
  const blackInH = /(?:^|;)\s*color\s*:\s*(?:#111827|black)\b/i.test(';' + hStyle);
  if (blackInH)
    failures.push(
      `${label} [黑字] h1/h2 发现 color:#111827 或 color:black，style 片段: "${hStyle.slice(0, 220)}"`,
    );

  // 紫色主色断言：整个 HTML 出现 7c3aed 或 632ebe
  const hasPurple = PURPLE_MARKERS.test(html);
  if (!hasPurple) failures.push(`${label} [主色] 未发现 #7c3aed 或 #632ebe（紫色渐变/纯色）`);

  const threeCenter = hasAllThreeCenters(html);
  if (threeCenter && !opts.allowCover) {
    failures.push(`${label} [三件套] 最外层同时 jc:center + ai:center + ta:center（非封面页禁止）`);
  }
  return { failures, outerFontFamily: ff, headingColorBlack: blackInH, hasPurple, threeCenter };
}

// ================================================================
// 构造 5 张最小 slidePlan：1 cover + 3 content + 1 summary
// （对应 finalGuard.generateFallbackSlide 直接调用的等价 finalGuard 产出）
// ================================================================
function buildMiniPlans(): SlidePlan[] {
  return [
    // cover
    {
      pageType: 'cover',
      title: '厄尔尼诺：赤道太平洋的“发烧”效应',
      keyPoints: ['探究成因机制', '解析全球现象', '评估社会影响'],
      needsImage: false,
    } as SlidePlan,
    // content 1
    {
      pageType: 'content-no-image',
      title: '探索厄尔尼诺的四个维度',
      keyPoints: [
        '现象定义：海洋的异常升温',
        '成因机制：大气与海洋的共舞',
        '全球影响：气候与社会的连锁反应',
        '应对策略：提升气候韧性的行动',
      ],
      needsImage: false,
    } as SlidePlan,
    // content 2
    {
      pageType: 'content-image-right',
      title: '赤道中东太平洋海表温度异常升高超0.5℃',
      keyPoints: [
        '核心定义：赤道中东太平洋海温持续异常偏暖',
        '判定标准：Niño3.4区海温指数连续5个月≥0.5℃',
        '发生周期：通常每2至7年发生一次，持续9-12个月',
      ],
      needsImage: true,
      imagePrompt: '赤道太平洋海温异常图',
      imageRatio: '4:3',
    } as SlidePlan,
    // content 3
    {
      pageType: 'content-no-image',
      title: '厄尔尼诺年引发全球极端气候指标显著波动',
      keyPoints: [
        '全球均温推高约0.1至0.2℃',
        '南美西海岸降水量激增超200%',
        '东南亚与澳洲干旱受灾面积扩大30%',
        '大西洋飓风生成数量平均减少40%',
      ],
      needsImage: false,
    } as SlidePlan,
    // summary (最后一页，对应 slide-08 场景 —— h2 + ul，最易触发 fallback 黑字/居中bug)
    {
      pageType: 'summary',
      title: '认识自然规律，提升全社会的气候韧性',
      keyPoints: [
        '厄尔尼诺是地球气候系统的自然脉动',
        '科学监测与提前干预是降低损失的关键',
        '携手应对极端天气，共建可持续发展未来',
      ],
      needsImage: false,
    } as SlidePlan,
  ];
}

// ================================================================
// T7.6：冷启动等价验证 —— 3 轮 × 5 页 × 4 断言
//   直接调用 generateFallbackSlide（等价 finalGuard 最后产出；renderSlides
//   其他环节已在 Task 4 调用点层面全验证过）
// ================================================================
describe('T7.6 冷启动等价验证：3 rounds × 5 slides × 4 assertions', () => {
  const agent = makeAgent() as AnyAgent;
  const PRIMARY = '#7c3aed';
  const DARKER = '#632ebe';

  const TOTAL_ROUNDS = 3;
  const plans = buildMiniPlans(); // 5 页

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    describe(`Round ${round} / ${TOTAL_ROUNDS}`, () => {
      plans.forEach((plan, idx) => {
        const pageLabel = `[Round${round}] page-${idx + 1} (${plan.pageType}): ${plan.title.slice(0, 24)}`;
        it(pageLabel, () => {
          const html: string = agent.generateFallbackSlide(plan, PRIMARY, 1280, 720, 'mono');

          // 封面允许三件套 true
          const allowCover = plan.pageType === 'cover';
          const { failures } = runFourAssertions(pageLabel, html, { allowCover });

          if (failures.length > 0) {
            // 提供 1 个样例输出片段（前 800 chars），便于定位
            const snippet = html.length > 800 ? html.slice(0, 800) + '…' : html;
            expect.fail(`${failures.join('\n')}\n\n=== 样例输出片段 ===\n${snippet}`);
          }
          expect(failures).toEqual([]);
        });
      });
    });
  }

  it('Round 汇总：3 轮 × 5 页 × 4 断言，共 60 断言，单文件报告便于统计', () => {
    // 纯汇总报告（不重复断言，仅为日志/可追溯性；真实断言在上面）
    let pass = 0;
    let fail = 0;
    const failLogs: string[] = [];
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      let roundPass = 0;
      let roundFail = 0;
      plans.forEach((plan, idx) => {
        const html: string = agent.generateFallbackSlide(plan, PRIMARY, 1280, 720, 'mono');
        const label = `[R${round}P${idx + 1}]`;
        const allowCover = plan.pageType === 'cover';
        const { failures } = runFourAssertions(label, html, { allowCover });
        // 每条 page 对应 4 断言：这里按 4 计数
        const perPage = 4;
        if (failures.length === 0) {
          roundPass += perPage;
          pass += perPage;
        } else {
          roundFail += failures.length;
          fail += failures.length;
          roundPass += Math.max(0, perPage - failures.length);
          pass += Math.max(0, perPage - failures.length);
          failLogs.push(`Round ${round} page ${idx + 1}: ${failures.join(' | ')}`);
        }
      });
      // 打印每轮汇总（vitest 通过时可见于 console）
      console.log(
        `[T7.6] Round ${round}: pass=${roundPass}, fail=${roundFail} (5 pages × 4 assertions = 20)`,
      );
    }
    console.log(`[T7.6] TOTAL 3 rounds: pass=${pass}, fail=${fail} / expected 60 assertions`);
    if (fail > 0) {
      expect.fail(`汇总失败: ${fail} 断言失败。\n${failLogs.slice(0, 5).join('\n')}`);
    }
    expect(pass).toBe(60);
    expect(fail).toBe(0);
  });
});

// ================================================================
// T7.7：真实 slides re-process (pres_mtghmyor_ntvs95e)
// 步骤：
//  1) LS slides 目录，收集 8 个 slide HTML
//  2) 读取 → 提取 slide 内容 div（去掉外层 body/wrapper/slide 壳）
//  3) 输出修复前基线故障表（sans / 黑 / 居中）
//  4) postProcessHtmlSnapshot(...) → 断言 4 条（封面三件套允许 true）
//  5) 汇总 100% 通过
// ================================================================
describe('T7.7 真实 slides re-process：pres_mtghmyor_ntvs95e', () => {
  const agent = makeAgent() as AnyAgent;
  const PRIMARY = '#7c3aed';
  const DARKER = '#632ebe';
  const SLIDES_DIR = path.join(
    'D:',
    'TraeSOLO',
    'NoPPT',
    'scripts',
    'output',
    'pres_mtghmyor_ntvs95e',
    'slides',
  );

  /** 每个 slide 文件是完整 HTML 壳，需剥到 <div class="slide"> 的第一个直接子 div 才是内容 HTML */
  function extractSlideInnerHtml(fullDoc: string): string {
    // 1. 找到 <div class="slide"> ... </div> 内部内容
    const slideRe = /<div\s+class="slide"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/body>/i;
    let block = fullDoc;
    const m = slideRe.exec(fullDoc);
    if (m) block = m[1];
    // 2. 取出第一个直接子 div（slide content 根），从第一个 <div 到最后一个 </div>
    const firstDiv = block.match(/<div\b([^>]*)>([\s\S]*)<\/div>\s*$/i);
    if (firstDiv) {
      return `<div${firstDiv[1]}>${firstDiv[2]}</div>`;
    }
    // fallback：返回整个 block
    return block.trim();
  }

  /** 判断文件名/内容是否封面：slide-01 或含 <h1 (非 <h2) */
  function isCoverSlide(fname: string, html: string): boolean {
    if (/slide-0[1\-_]/.test(fname)) return true;
    if (/<h1\b/i.test(html)) return true;
    return false;
  }

  // ============== 基线（修复前）故障统计 ==============
  it('A. 修复前基线故障表（pres_mtghmyor_ntvs95e 是修复前产物）', () => {
    const files = fs
      .readdirSync(SLIDES_DIR)
      .filter((f) => f.endsWith('.html'))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    let sansFault = 0;
    let blackFault = 0;
    let centerFault = 0;
    const perFile: Array<{ file: string; sans: boolean; black: boolean; center: boolean }> = [];

    for (const f of files) {
      const full = fs.readFileSync(path.join(SLIDES_DIR, f), 'utf-8');
      const inner = extractSlideInnerHtml(full);
      const ff = getOuterFontFamily(inner);

      // sans 故障：font-family 为 system-ui,-apple-system 或 sans-serif，且无 mono 栈
      const hasSans = SANS_MARKERS.test(ff) && !MONO_MARKERS.test(ff);
      // 黑色故障：h1/h2 style 中 color:#111827 / color:black
      const hStyle = getHeadingStyles(inner);
      const hasBlack = /(?:^|;)\s*color\s*:\s*(?:#111827|black)\b/i.test(';' + hStyle);
      // 居中故障：非封面 且 三件套同时 true
      const cover = isCoverSlide(f, inner);
      const threeC = hasAllThreeCenters(inner);
      const hasCenter = !cover && threeC;

      if (hasSans) sansFault++;
      if (hasBlack) blackFault++;
      if (hasCenter) centerFault++;
      perFile.push({ file: f, sans: hasSans, black: hasBlack, center: hasCenter });
    }

    const total = files.length;
    const table = `
=============================================
[T7.7-A] 修复前基线故障统计（${total} 张 slides）
---------------------------------------------
 总数 N   | sans 故障  | 黑字故障  | 居中故障
   ${total.toString().padEnd(6)}|    ${sansFault.toString().padEnd(6)} |   ${blackFault.toString().padEnd(6)} |   ${centerFault.toString().padEnd(6)}
=============================================
Per-file details:
${perFile
  .map(
    (p) =>
      `  ${p.file.padEnd(70)} | sans=${p.sans ? '✗' : '✓'} | black=${p.black ? '✗' : '✓'} | center3=${p.center ? '✗' : '✓'}`,
  )
  .join('\n')}
`;
    console.log(table);
    // 期望 slide-08 触发全部三种故障（sanity check，不 fail）
    const slide08 = perFile.find((p) => /slide-08/.test(p.file));
    if (slide08) {
      console.log(
        `[T7.7-A] slide-08 基线: sans=${slide08.sans}, black=${slide08.black}, center=${slide08.center} （预期三者全 true = bug）`,
      );
      // 注意：此处不做 fail —— 因为 spec 说 slide-08 是"修复前预期有大量故障"的例子
    }
    // 至少 slide-08 存在 3 项故障，以证明基线采集有效（这是本项唯一断言）
    const totalFaultsPerFile = perFile.map(
      (p) => Number(p.sans) + Number(p.black) + Number(p.center),
    );
    const maxFaults = Math.max(0, ...totalFaultsPerFile);
    expect(maxFaults).toBeGreaterThanOrEqual(1);
    // 输出基线数据，后续 item B 会依赖这里的故障并修复它们
    expect(sansFault + blackFault + centerFault).toBeGreaterThan(0);
  });

  // ============== 修复后 re-process 断言 100% 通过 ==============
  it('B. postProcessHtmlSnapshot → 100% 通过（封面三件套为例外）', () => {
    const files = fs
      .readdirSync(SLIDES_DIR)
      .filter((f) => f.endsWith('.html'))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    let passed = 0;
    let totalAsserts = 0;
    let coverExceptions = 0;
    const failuresList: Array<{ file: string; assertion: string }> = [];

    for (const f of files) {
      const full = fs.readFileSync(path.join(SLIDES_DIR, f), 'utf-8');
      const originalInner = extractSlideInnerHtml(full);
      const cover = isCoverSlide(f, originalInner);

      const reprocessed = agent.postProcessHtmlSnapshot(originalInner, {
        fontFamily: 'mono',
        primaryColor: PRIMARY,
        primaryColorDarker: DARKER,
        slideWidth: 1280,
        slideHeight: 720,
        backgroundEnabled: false,
      }) as string;

      expect(reprocessed).toBeTruthy();
      expect(typeof reprocessed).toBe('string');

      const label = `[T7.7-B] ${f}`;
      const { failures, threeCenter } = runFourAssertions(label, reprocessed, {
        allowCover: cover,
      });

      totalAsserts += 4;
      if (failures.length === 0) {
        passed += 4;
      } else {
        passed += Math.max(0, 4 - failures.length);
        for (const fl of failures) failuresList.push({ file: f, assertion: fl });
      }

      if (cover && threeCenter) {
        coverExceptions++;
      }
    }

    const total = files.length;
    const report = `
=============================================
[T7.7-B] 修复后 re-process 结果（${total} 张 slides）
---------------------------------------------
 断言通过: ${passed} / ${totalAsserts}  (每张 4 条)
 幻灯片通过: ${failuresList.length === 0 ? total : total - new Set(failuresList.map((x) => x.file)).size} / ${total}
 封面三件套命中 true（合法例外）: ${coverExceptions} 个
=============================================
`;
    console.log(report);
    if (coverExceptions > 0) {
      console.log(
        `[T7.7-B] 封面命中 true ${coverExceptions} 个，均合法（封面允许 jc+ai+ta=center）。`,
      );
    }
    if (failuresList.length > 0) {
      const detail = failuresList
        .slice(0, 12)
        .map((f) => `  - ${f.file} → ${f.assertion}`)
        .join('\n');
      expect.fail(`${report}失败列表（前 12）:\n${detail}`);
    }
    // 100% 通过
    expect(passed).toBe(totalAsserts);
    expect(failuresList).toEqual([]);
  });
});
