/**
 * shared.ts 二次拆分产出：图片尺寸与模型路由
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import { formatBeijingTime } from '../../providers/base';
import type { ImageModelRoutingConfig, ImageRatio, ImageRouteScene, ImageSize, SlidePageType } from '../../types';
import { getQualityScore, getSpeedScore, parseModelName } from '../../utils/model-name-parser';
import type { CandidateModel, PixelRange } from './types';

export const PAGE_TYPE_DEFAULT_IMAGE_RATIO: Record<SlidePageType, ImageRatio | null> = {
  cover: null,
  toc: null,
  summary: null,
  'content-image-left': '4:3',
  'content-image-right': '4:3',
  'content-image-top': '21:9', // 更宽更扁，给上图下文布局的文字留垂直空间（原图 16:9 偏高易溢出）
  'content-no-image': null,
  'content-cards': null,
  'content-compare': null,
  'content-timeline': null,
  'content-table': null,
  // ===== L1 高级版式默认图片比例 =====
  'comparison-deep-dive': null, // 无图，以文字+进度条+徽章为主
  'content-zigzag': '4:3', // Z 字三段都配图
  'content-value-showcase': null, // 纯数值大卡展示，无图
  'content-stats-highlight': null, // 指标并列展示，无图
  'content-image-background': '16:9', // 背景大图 16:9
  // ===== FR-18 §18.1 扩展（均无图）=====
  'content-flowchart': null,
  'content-org-chart': null,
  'content-pyramid': null,
  'content-matrix': null,
  'content-quote': null,
  'content-three-section': null,
  'content-process-steps': null,
  'content-icon-grid': null,
  'content-section-divider': null,
  'content-testimonial': null,
  // ===== FR-18 §18.5 扩展（图形页，均无图）=====
  'content-chart-bar': null,
  'content-chart-line': null,
  'content-chart-pie': null,
  'content-chart-donut': null,
  'content-cycle': null,
  'content-dashboard': null,
  'content-architecture': null,
};

/**
 * 上图下文（content-image-top）布局根据 keyPoints 数量动态选择更合理的图片比例：
 * 要点越多 → 图片越扁 → 给文字区腾更多垂直空间，防止溢出
 */

export function defaultRatioForImageTop(keyPoints?: string[] | null): ImageRatio {
  const n = Array.isArray(keyPoints) ? keyPoints.length : 0;
  if (n >= 4) return '21:9'; // 4+ 要点：最扁，优先保证文字不溢出
  return '21:9'; // ≤3 要点也用 21:9，比旧 16:9 更安全，后续若需要可按 n=2/3 调回 16:9
}


export const IMAGE_SIZE_MAPPINGS: Record<string, Record<ImageRatio, ImageSize>> = {
  seedream: {
    '1:1': '2048x2048',
    '4:3': '2304x1728',
    '3:4': '1728x2304',
    '16:9': '2848x1600',
    '9:16': '1600x2848',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    // 21:9 = 2.333，3136x1344 = 2.333（准确命中）
    '21:9': '3136x1344',
  },
  'qwen-image-2': {
    '1:1': '2048x2048',
    '4:3': '2368x1728',
    '3:4': '1728x2368',
    '16:9': '2688x1536',
    '9:16': '1536x2688',
    '3:2': '2048x2048',
    '2:3': '1728x2368',
    // 21:9 → 3136x1344（2.333），而不是 2688x1536（1.75 = 16:9）
    '21:9': '3136x1344',
  },
  'qwen-image-1': {
    '1:1': '1328x1328',
    '4:3': '1472x1104',
    '3:4': '1104x1472',
    '16:9': '1664x928',
    '9:16': '928x1664',
    '3:2': '1472x1104',
    '2:3': '1104x1472',
    // qwen-image-1 枚举内无标准 21:9 尺寸，选最宽的 1664x928（1.79）— 至少不再退回方形
    '21:9': '1664x928',
  },
  fallback: {
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '3:2': '1024x768',
    '2:3': '768x1024',
    // 21:9 → 3136x1344（2.333），而不是 1792x1024（1.75=16:9）
    '21:9': '3136x1344',
  },
};


export function computeAlignedSizeForRatio(
  ratio: ImageRatio,
  pixelRanges: Array<PixelRange>,
  align: number = 32,
): { width: number; height: number } | null {
  if (!pixelRanges || pixelRanges.length === 0) return null;
  const [a, b] = ratio.split(':').map(Number) as [number, number];
  if (!a || !b) return null;
  // 遍历所有 range，每个 range 计算一个候选，选最接近 range 中点的
  let best: { width: number; height: number } | null = null;
  let bestCloseness = Infinity;
  for (const range of pixelRanges) {
    const midPx = (range.minPixels + range.maxPixels) / 2;
    // 解 w/h = a/b，w*h = midPx → h = sqrt(midPx * b / a)，w = h * a / b
    let hRaw = Math.sqrt((midPx * b) / a);
    let wRaw = (hRaw * a) / b;
    // 对齐到 align 倍数（向下取整）
    let wOk = Math.floor(wRaw / align) * align;
    let hOk = Math.floor(hRaw / align) * align;
    if (wOk < align || hOk < align) continue;
    const pixels = wOk * hOk;
    if (pixels < range.minPixels || pixels > range.maxPixels) {
      // 如果超出，尝试把 wOk/hOk 各加减 ±2*align 找落在 range 内且比例最接近 a/b 的候选
      const candidates: Array<[number, number]> = [];
      for (let dw = -3 * align; dw <= 3 * align; dw += align) {
        for (let dh = -3 * align; dh <= 3 * align; dh += align) {
          const wc = wOk + dw;
          const hc = hOk + dh;
          if (wc <= 0 || hc <= 0) continue;
          const pc = wc * hc;
          if (pc >= range.minPixels && pc <= range.maxPixels) candidates.push([wc, hc]);
        }
      }
      if (candidates.length === 0) continue;
      let cBest: [number, number] = candidates[0];
      let cBestDiff = Infinity;
      for (const [wc, hc] of candidates) {
        const diff = Math.abs(wc / hc - a / b) / (a / b);
        if (diff < cBestDiff) {
          cBestDiff = diff;
          cBest = [wc, hc];
        }
      }
      [wOk, hOk] = cBest;
    }
    // 与像素中点的接近度（越小越好），归一化到 range 长度
    const closeness = Math.abs(wOk * hOk - midPx) / Math.max(1, range.maxPixels - range.minPixels);
    if (closeness < bestCloseness) {
      bestCloseness = closeness;
      best = { width: wOk, height: hOk };
    }
  }
  return best;
}


export function getImageSizeForRatio(
  model: string | undefined,
  ratio: ImageRatio,
  availableSizes?: Array<{ width: number; height: number; label?: string }>,
  pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>,
): ImageSize {
  const ratioMap: Record<ImageRatio, number> = {
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '21:9': 21 / 9,
  };
  const targetRatio = ratioMap[ratio];

  // ============== 优先方案 A：在 availableSizes（用户配置的显式尺寸）里找最匹配比例的 ==============
  if (availableSizes && availableSizes.length > 0) {
    let bestSize = availableSizes[0];
    let bestDiff = Infinity;
    for (const size of availableSizes) {
      const actualRatio = size.width / size.height;
      const diff = Math.abs(actualRatio - targetRatio) / targetRatio;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSize = size;
      }
    }
    // 比例误差 ≤30%：就用用户配置的尺寸（尊重配置，哪怕不完全对）
    if (bestDiff <= 0.3) {
      return `${bestSize.width}x${bestSize.height}` as ImageSize;
    }

    // ============== 优先方案 B：availableSizes 比例不对（全是方形），根据 pixelRanges 动态计算 ==============
    //            不再吸附回联合枚举，只要 w*h ∈ [minPixels, maxPixels] 就直接返回
    if (pixelRanges && pixelRanges.length > 0) {
      const computed = computeAlignedSizeForRatio(ratio, pixelRanges as PixelRange[]);
      if (computed && computed.width > 0 && computed.height > 0) {
        const { width, height } = computed;
        return `${width}x${height}` as ImageSize;
      }
    }
  } else {
    // availableSizes 为空：如果 pixelRanges 有值，直接按 pixelRanges 算（避免走硬编码mapping拿方形）
    if (pixelRanges && pixelRanges.length > 0) {
      const computed = computeAlignedSizeForRatio(ratio, pixelRanges as PixelRange[]);
      if (computed && computed.width > 0 && computed.height > 0) {
        const { width, height } = computed;
        return `${width}x${height}` as ImageSize;
      }
    }
  }

  // ============== 兜底方案 C：硬编码 mapping（没有配置 pixelRanges 时） ==============
  const modelLower = (model || '').toLowerCase();
  let mapping: Record<ImageRatio, ImageSize>;
  if (modelLower.includes('seedream') || modelLower.includes('doubao')) {
    mapping = IMAGE_SIZE_MAPPINGS.seedream;
  } else if (modelLower.includes('qwen-image-2') || modelLower.includes('qwen-vl-max')) {
    mapping = IMAGE_SIZE_MAPPINGS['qwen-image-2'];
  } else if (
    modelLower.includes('qwen-image') ||
    modelLower.includes('qwen-image-max') ||
    modelLower.includes('qwen-image-plus')
  ) {
    mapping = IMAGE_SIZE_MAPPINGS['qwen-image-1'];
  } else {
    mapping = IMAGE_SIZE_MAPPINGS.fallback;
  }
  return mapping[ratio] || mapping['16:9'] || '1024x1024';
}


export function ratioMatchesSize(ratio: ImageRatio, width: number, height: number): boolean {
  const ratioMap: Record<ImageRatio, number> = {
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '21:9': 21 / 9,
  };
  const targetRatio = ratioMap[ratio];
  const actualRatio = width / height;
  return Math.abs(actualRatio - targetRatio) / targetRatio <= 0.05;
}


export function getRouteScene(pageType: SlidePageType): ImageRouteScene {
  if (pageType === 'cover') return 'cover';
  if (
    [
      'toc',
      'content-cards',
      'content-compare',
      'content-timeline',
      'content-table',
      'summary',
      // FR-18 扩展（均为非配图页，归入 secondary 路由，避免误走 content 配图模型）
      'content-flowchart',
      'content-org-chart',
      'content-pyramid',
      'content-matrix',
      'content-quote',
      'content-three-section',
      'content-process-steps',
      'content-icon-grid',
      'content-section-divider',
      'content-testimonial',
      'content-chart-bar',
      'content-chart-line',
      'content-chart-pie',
      'content-chart-donut',
      'content-cycle',
      'content-dashboard',
      'content-architecture',
    ].includes(pageType)
  ) {
    return 'secondary';
  }
  return 'content';
}


export function selectImageModel(
  allModels: CandidateModel[],
  pageType: SlidePageType,
  targetRatio: ImageRatio,
  routingConfig?: ImageModelRoutingConfig,
  defaultModelName?: string,
): { modelName: string; modelIndex: number } {
  if (!routingConfig?.enabled || allModels.length === 0) {
    const fallback = allModels[0];
    return {
      modelName: fallback?.modelName || defaultModelName || '',
      modelIndex: fallback?.index || 0,
    };
  }

  const scene = getRouteScene(pageType);
  const manualIndex =
    scene === 'cover'
      ? routingConfig.coverModelIndex
      : scene === 'content'
        ? routingConfig.contentModelIndex
        : routingConfig.secondaryModelIndex;

  if (manualIndex !== undefined && manualIndex >= 0 && manualIndex < allModels.length) {
    const manual = allModels[manualIndex];
    return { modelName: manual.modelName, modelIndex: manual.index };
  }

  const candidates = allModels.filter((m) => {
    const matchingSizes = m.sizes.filter((s) => ratioMatchesSize(targetRatio, s.width, s.height));
    if (matchingSizes.length === 0) return false;
    if (m.pixelRanges && m.pixelRanges.length > 0) {
      const hasMatchingRange = matchingSizes.some((s) => {
        const pixels = s.width * s.height;
        return m.pixelRanges!.some((r) => pixels >= r.minPixels && pixels <= r.maxPixels);
      });
      if (!hasMatchingRange) return false;
    }
    return true;
  });

  const pool = candidates.length > 0 ? candidates : allModels;

  const scored = pool.map((m) => {
    const parsed = parseModelName(m.modelName);
    const quality = getQualityScore(parsed);
    const speed = getSpeedScore(parsed);
    return { model: m, quality, speed };
  });

  let sorted;
  if (scene === 'cover') {
    sorted = scored.sort((a, b) => b.quality - a.quality || a.speed - b.speed);
  } else if (scene === 'secondary') {
    sorted = scored.sort((a, b) => b.speed - a.speed || a.quality - b.quality);
  } else {
    sorted = scored.sort((a, b) => {
      const scoreA = a.quality * 0.6 + a.speed * 0.4;
      const scoreB = b.quality * 0.6 + b.speed * 0.4;
      return scoreB - scoreA;
    });
  }

  const selected = sorted[0]?.model || allModels[0];
  const parsed = parseModelName(selected.modelName);
  console.log(
    `[${formatBeijingTime()}] [ROUTING] pageType=${pageType} scene=${scene} ratio=${targetRatio} → ${selected.modelName} (quality=${getQualityScore(parsed)}, speed=${getSpeedScore(parsed)})`,
  );
  return { modelName: selected.modelName, modelIndex: selected.index };
}

