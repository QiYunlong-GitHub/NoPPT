import type { ImageDataLike } from '../png-decoder';
import { rgbToHsv } from './color-utils';

export function downsampleImage(imageData: ImageDataLike, maxLongEdge: number): ImageDataLike {
  const { data, width, height } = imageData;
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { data, width, height };
  }

  const scale = maxLongEdge / longEdge;
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(newW * newH * 4);

  for (let y = 0; y < newH; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const srcIdx = (sy * width + sx) * 4;
      const dstIdx = (y * newW + x) * 4;
      out[dstIdx] = data[srcIdx];
      out[dstIdx + 1] = data[srcIdx + 1];
      out[dstIdx + 2] = data[srcIdx + 2];
      out[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return { data: out, width: newW, height: newH };
}

export function toGrayscale(imageData: ImageDataLike): Float64Array {
  const { data, width, height } = imageData;
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  return gray;
}

export function extractHsvHistogram(imageData: ImageDataLike, bins = 360): {
  hist: Float64Array;
  satWeightedHist: Float64Array;
  totalWeight: number;
} {
  const { data, width, height } = imageData;
  const hist = new Float64Array(bins);
  const satWeightedHist = new Float64Array(bins);
  let totalWeight = 0;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const { h, s } = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);
    if (s < 0.1) continue;

    const bin = Math.min(bins - 1, Math.floor(h / 360 * bins));
    hist[bin] += 1;
    satWeightedHist[bin] += s;
    totalWeight += s;
  }

  return { hist, satWeightedHist, totalWeight };
}
