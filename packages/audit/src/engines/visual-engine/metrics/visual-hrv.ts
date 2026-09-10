export interface VisualHrvResult {
  rmssd: number;
  deltas: number[];
  overloadCount: number;
  score: number;
  interpretation:
    'flatline' | 'healthy_pulse' | 'transitional' | 'strobe_light' | 'insufficient_data';
  normalizedScores: number[];
}

export function sigmoidNormalize(x: number, mu = 5.5, k = 1.5): number {
  return 1 / (1 + Math.exp(-k * (x - mu)));
}

export function calculateRmssd(values: number[]): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (let i = 0; i < values.length - 1; i++) {
    const d = values[i + 1] - values[i];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

function countOverload(values: number[], window: number, threshold: number): number {
  if (window < 1 || values.length < window) return 0;
  let count = 0;
  for (let i = 0; i <= values.length - window; i++) {
    let sum = 0;
    for (let j = 0; j < window; j++) sum += values[i + j];
    if (sum / window > threshold) count++;
  }
  return count;
}

export function computeVisualHrv(
  complexities: number[],
  options: {
    targetRmssd?: number;
    targetHalfwidth?: number;
    overloadWindow?: number;
    overloadThreshold?: number;
    overloadPenalty?: number;
    mu?: number;
    k?: number;
  } = {},
): VisualHrvResult {
  const {
    targetRmssd = 0.25,
    targetHalfwidth = 0.25,
    overloadWindow = 3,
    overloadThreshold = 0.75,
    overloadPenalty = 10,
    mu = 5.5,
    k = 1.5,
  } = options;

  if (complexities.length === 0) {
    return {
      rmssd: 0,
      deltas: [],
      overloadCount: 0,
      score: 0,
      interpretation: 'insufficient_data',
      normalizedScores: [],
    };
  }

  const normalized = complexities.map((v) => {
    const s = sigmoidNormalize(v, mu, k);
    return Math.max(0, Math.min(1, s));
  });

  const deltas: number[] = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    deltas.push(Math.abs(normalized[i + 1] - normalized[i]));
  }

  const rmssd = calculateRmssd(normalized);
  const overloadCount = countOverload(normalized, overloadWindow, overloadThreshold);

  const baseScore =
    targetHalfwidth > 0
      ? 100 * (1 - Math.min(1, Math.abs(rmssd - targetRmssd) / targetHalfwidth))
      : 0;
  const score = Math.max(0, Math.min(100, baseScore - overloadPenalty * overloadCount));

  let interpretation: VisualHrvResult['interpretation'];
  if (rmssd < 0.1) interpretation = 'flatline';
  else if (rmssd > 0.5) interpretation = 'strobe_light';
  else if (rmssd >= 0.15 && rmssd <= 0.35) interpretation = 'healthy_pulse';
  else interpretation = 'transitional';

  return {
    rmssd,
    deltas,
    overloadCount,
    score,
    interpretation,
    normalizedScores: normalized,
  };
}
