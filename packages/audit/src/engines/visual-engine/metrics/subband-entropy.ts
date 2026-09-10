import type { ImageDataLike } from '../png-decoder';
import { downsampleImage, toGrayscale } from './image-utils';

export interface HaarSubbands {
  ll: Float64Array;
  lh: Float64Array;
  hl: Float64Array;
  hh: Float64Array;
  width: number;
  height: number;
}

export interface SubbandEntropyResult {
  entropy: number;
  llEntropy: number;
  lhEntropy: number;
  hlEntropy: number;
  hhEntropy: number;
  score: number;
}

function haar1D(arr: Float64Array, length: number): { approx: Float64Array; detail: Float64Array } {
  const half = length >> 1;
  const approx = new Float64Array(half);
  const detail = new Float64Array(half);
  const invSqrt2 = 1 / Math.SQRT2;
  for (let i = 0; i < half; i++) {
    const a = arr[i * 2];
    const b = arr[i * 2 + 1];
    approx[i] = (a + b) * invSqrt2;
    detail[i] = (a - b) * invSqrt2;
  }
  return { approx, detail };
}

export function haar2D(gray: Float64Array, width: number, height: number): HaarSubbands {
  const evenW = width - (width % 2);
  const evenH = height - (height % 2);
  const halfW = evenW >> 1;
  const halfH = evenH >> 1;

  const rowApprox = new Float64Array(evenH * halfW);
  const rowDetail = new Float64Array(evenH * halfW);

  for (let y = 0; y < evenH; y++) {
    const row = gray.subarray(y * width, y * width + evenW);
    const { approx, detail } = haar1D(row as Float64Array, evenW);
    rowApprox.set(approx, y * halfW);
    rowDetail.set(detail, y * halfW);
  }

  const ll = new Float64Array(halfH * halfW);
  const hl = new Float64Array(halfH * halfW);
  const lh = new Float64Array(halfH * halfW);
  const hh = new Float64Array(halfH * halfW);

  const colBufA = new Float64Array(evenH);
  const colBufD = new Float64Array(evenH);

  for (let x = 0; x < halfW; x++) {
    for (let y = 0; y < evenH; y++) {
      colBufA[y] = rowApprox[y * halfW + x];
      colBufD[y] = rowDetail[y * halfW + x];
    }
    const aA = haar1D(colBufA, evenH);
    const dA = haar1D(colBufD, evenH);
    for (let y = 0; y < halfH; y++) {
      const idx = y * halfW + x;
      ll[idx] = aA.approx[y];
      hl[idx] = aA.detail[y];
      lh[idx] = dA.approx[y];
      hh[idx] = dA.detail[y];
    }
  }

  return { ll, lh, hl, hh, width: halfW, height: halfH };
}

function shannonEntropy(data: Float64Array, bins = 256): number {
  if (data.length === 0) return 0;

  let min = data[0];
  let max = data[0];
  for (let i = 1; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  if (range < 1e-12) return 0;

  const hist = new Float64Array(bins);
  const scale = bins / range;
  for (let i = 0; i < data.length; i++) {
    let bin = Math.floor((data[i] - min) * scale);
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    hist[bin]++;
  }

  const total = data.length;
  let entropy = 0;
  for (let i = 0; i < bins; i++) {
    const count = hist[i];
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

export function computeSubbandEntropy(
  imageData: ImageDataLike,
  targetSize = 256,
): SubbandEntropyResult {
  const sampled = downsampleImage(imageData, targetSize);
  const gray = toGrayscale(sampled);
  const subbands = haar2D(gray, sampled.width, sampled.height);

  const llEntropy = shannonEntropy(subbands.ll);
  const lhEntropy = shannonEntropy(subbands.lh);
  const hlEntropy = shannonEntropy(subbands.hl);
  const hhEntropy = shannonEntropy(subbands.hh);

  const entropy = (lhEntropy + hlEntropy + hhEntropy) / 3;

  const target = 3.5;
  const tolerance = 2.0;
  const score = Math.max(
    0,
    Math.min(1, 1 - Math.abs(entropy - target) / tolerance),
  );

  return {
    entropy,
    llEntropy,
    lhEntropy,
    hlEntropy,
    hhEntropy,
    score,
  };
}
