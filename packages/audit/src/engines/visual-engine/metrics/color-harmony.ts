import type { ImageDataLike } from '../png-decoder';
import { hueDistance } from './color-utils';
import { downsampleImage, extractHsvHistogram } from './image-utils';

export type HueTemplate = Array<[number, number]>;

export const HUE_TEMPLATES: Record<string, HueTemplate> = {
  i: [[0.0, 0.05]],
  V: [[0.0, 0.26]],
  L: [
    [0.0, 0.05],
    [0.25, 0.22],
  ],
  mirror_L: [
    [0.0, 0.05],
    [-0.25, 0.22],
  ],
  I: [
    [0.0, 0.05],
    [0.5, 0.05],
  ],
  T: [[0.25, 0.5]],
  Y: [
    [0.0, 0.26],
    [0.5, 0.05],
  ],
  X: [
    [0.0, 0.26],
    [0.5, 0.26],
  ],
};

export interface ColorHarmonyResult {
  bestTemplate: string;
  bestAlpha: number;
  bestDistance: number;
  score: number;
  templateDistances: Record<string, number>;
}

function sectorDistance(hue: number, center: number, width: number): number {
  const halfWidth = width / 2;
  const distToCenter = hueDistance(hue, center);
  if (distToCenter < halfWidth) return 0;
  const border1 = center - halfWidth;
  const border2 = center + halfWidth;
  return Math.min(hueDistance(hue, border1), hueDistance(hue, border2));
}

function templateScoreAtAlpha(
  template: HueTemplate,
  alpha: number,
  satWeightedHist: Float64Array,
  totalWeight: number,
): number {
  if (totalWeight === 0) return 180;

  let weightedSum = 0;
  const bins = satWeightedHist.length;

  for (let bin = 0; bin < bins; bin++) {
    const weight = satWeightedHist[bin];
    if (weight === 0) continue;

    const hue = (bin + 0.5) * (360 / bins);
    let minDist = 180;
    for (const [centerRatio, widthRatio] of template) {
      const center = centerRatio * 360 + alpha;
      const width = widthRatio * 360;
      const d = sectorDistance(hue, center, width);
      if (d < minDist) minDist = d;
    }
    weightedSum += weight * minDist;
  }

  return weightedSum / totalWeight;
}

export function computeColorHarmony(
  imageData: ImageDataLike,
  sigma = 12,
  maxPixels = 100000,
): ColorHarmonyResult {
  const sampled = downsampleImage(imageData, Math.sqrt(maxPixels));
  const { satWeightedHist, totalWeight } = extractHsvHistogram(sampled, 360);

  let bestTemplate = 'i';
  let bestAlpha = 0;
  let bestDistance = 180;
  const templateDistances: Record<string, number> = {};

  for (const [name, template] of Object.entries(HUE_TEMPLATES)) {
    let templateBest = 180;
    let templateBestAlpha = 0;
    for (let alpha = 0; alpha < 360; alpha++) {
      const score = templateScoreAtAlpha(template, alpha, satWeightedHist, totalWeight);
      if (score < templateBest) {
        templateBest = score;
        templateBestAlpha = alpha;
      }
    }
    templateDistances[name] = templateBest;
    if (templateBest < bestDistance) {
      bestDistance = templateBest;
      bestTemplate = name;
      bestAlpha = templateBestAlpha;
    }
  }

  const score = Math.exp(-(bestDistance * bestDistance) / (2 * sigma * sigma));

  return {
    bestTemplate,
    bestAlpha,
    bestDistance,
    score,
    templateDistances,
  };
}
