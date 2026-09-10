import type { ImageDataLike } from '../png-decoder';
import { downsampleImage } from './image-utils';

export interface ColorfulnessResult {
  colorfulness: number;
  score: number;
  rgMean: number;
  ybMean: number;
  rgStd: number;
  ybStd: number;
}

export function computeColorfulness(
  imageData: ImageDataLike,
  maxLongEdge = 300,
): ColorfulnessResult {
  const sampled = downsampleImage(imageData, maxLongEdge);
  const { data, width, height } = sampled;
  const n = width * height;

  let sumRg = 0;
  let sumYb = 0;
  let sumRgSq = 0;
  let sumYbSq = 0;

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRg += rg;
    sumYb += yb;
    sumRgSq += rg * rg;
    sumYbSq += yb * yb;
  }

  const meanRg = sumRg / n;
  const meanYb = sumYb / n;
  const varRg = sumRgSq / n - meanRg * meanRg;
  const varYb = sumYbSq / n - meanYb * meanYb;
  const stdRg = Math.sqrt(Math.max(0, varRg));
  const stdYb = Math.sqrt(Math.max(0, varYb));

  const stdRoot = Math.sqrt(stdRg * stdRg + stdYb * stdYb);
  const meanRoot = Math.sqrt(meanRg * meanRg + meanYb * meanYb);
  const colorfulness = stdRoot + 0.3 * meanRoot;

  const score = Math.max(0, Math.min(100, colorfulness));

  return {
    colorfulness,
    score,
    rgMean: meanRg,
    ybMean: meanYb,
    rgStd: stdRg,
    ybStd: stdYb,
  };
}
