import type { Page } from 'playwright-core';
export type FontState = 'resolved' | 'fallback' | 'unverified' | 'failed';
export type FontWeightState = 'matched' | 'mismatch' | 'unverified';
export type FontMetricStatus = 'ok' | 'warn' | 'fail';

export interface FontProfile {
  declaredFamily: string;
  fallbackStack: string[];
  weight: number | string;
  language?: string;
  source?: string;
}

export interface FontMetricThresholds {
  warning: number;
  failure: number;
}

export const DEFAULT_FONT_METRIC_THRESHOLDS: FontMetricThresholds = {
  warning: 0.05,
  failure: 0.1,
};

export interface FontObservation {
  fontsApiAvailable: boolean;
  fontCheck?: boolean;
  fontChecks?: Record<string, boolean>;
  resolvedFamily: string;
  resolvedWeight?: number | string;
  fontSize?: number;
  lineHeight?: number;
  baselineWidth?: number;
  baselineHeight?: number;
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  canvasWidthDelta?: number;
  canvasHeightDelta?: number;
}

export interface FontValidationResult {
  state: FontState;
  profile: FontProfile;
  declaredFamily: string;
  resolvedFamily: string;
  declaredWeight: number | string;
  resolvedWeight?: number | string;
  fontSize?: number;
  lineHeight?: number;
  domMetrics: {
    scrollWidth?: number;
    clientWidth?: number;
    scrollHeight?: number;
    clientHeight?: number;
  };
  fontChecks?: Record<string, boolean>;
  weightState: FontWeightState;
  fallbackUsed: boolean;
  metricStatus: FontMetricStatus;
  maxMetricDelta: number;
  metricDeltas: {
    width: number;
    height: number;
    canvas: number;
  };
  reason?: string;
}

export interface FontIconCheckResult {
  fontFamilyCount: number;
  fontFamilies: string[];
  fontSizeLevels: number;
  fontSizes: number[];
  iconStyles: string[];
  iconStyleConsistent: boolean;
  font: FontValidationResult;
  layoutProfile?: string;
}

interface RawFontIconData {
  fontFamilies: string[];
  fontSizes: number[];
  iconStyles: string[];
  observation: FontObservation;
  layoutProfile?: string;
}

interface FontCollectionProfile {
  declaredFamily: string;
  fallbackStack: string[];
  weight: number | string;
}

function normalizeFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}

function weightsMatch(declared: number | string, resolved: number | string | undefined): boolean {
  if (resolved === undefined || resolved === '') return false;
  const declaredNumber = Number(declared);
  const resolvedNumber = Number(resolved);
  if (Number.isFinite(declaredNumber) && Number.isFinite(resolvedNumber)) {
    return declaredNumber === resolvedNumber;
  }
  return String(declared).trim().toLowerCase() === String(resolved).trim().toLowerCase();
}

function relativeDelta(observed: number | undefined, baseline: number | undefined): number {
  if (observed === undefined || baseline === undefined || !Number.isFinite(observed) || !Number.isFinite(baseline)) {
    return 0;
  }
  return Math.abs(observed - baseline) / Math.max(Math.abs(baseline), 1);
}

export function classifyFontObservation(
  observation: FontObservation,
  profile: FontProfile,
  thresholds: FontMetricThresholds = DEFAULT_FONT_METRIC_THRESHOLDS,
): FontValidationResult {
  const declaredFamily = profile.declaredFamily.trim();
  const resolvedFamily = observation.resolvedFamily.trim();
  const resolvedName = normalizeFamily(resolvedFamily);
  const declaredName = normalizeFamily(declaredFamily);
  const fallbackUsed = Boolean(resolvedName && resolvedName !== declaredName);
  const familyMatches = resolvedName === declaredName;
  const weightState: FontWeightState = !observation.fontsApiAvailable
    ? 'unverified'
    : weightsMatch(profile.weight, observation.resolvedWeight)
      ? 'matched'
      : 'mismatch';

  const widthDelta = observation.clientWidth && observation.clientWidth > 0
    ? Math.max(0, (observation.scrollWidth || observation.clientWidth) - observation.clientWidth) / observation.clientWidth
    : relativeDelta(observation.scrollWidth, observation.baselineWidth);
  const heightDelta = observation.clientHeight && observation.clientHeight > 0
    ? Math.max(0, (observation.scrollHeight || observation.clientHeight) - observation.clientHeight) / observation.clientHeight
    : relativeDelta(observation.scrollHeight, observation.baselineHeight);
  const canvasDelta = Math.max(observation.canvasWidthDelta || 0, observation.canvasHeightDelta || 0);
  const maxMetricDelta = Math.max(widthDelta, heightDelta, canvasDelta);
  const metricStatus: FontMetricStatus = maxMetricDelta >= thresholds.failure
    ? 'fail'
    : maxMetricDelta >= thresholds.warning
      ? 'warn'
      : 'ok';

  let state: FontState;
  let reason: string | undefined;
  if (!observation.fontsApiAvailable) {
    state = 'unverified';
    reason = 'document.fonts is unavailable';
  } else if (!resolvedFamily) {
    state = 'failed';
    reason = 'No resolved font family was observed';
  } else if (weightState === 'mismatch') {
    state = 'failed';
    reason = `Declared weight ${String(profile.weight)} resolved as ${String(observation.resolvedWeight)}`;
  } else if (fallbackUsed || !familyMatches) {
    state = 'fallback';
    reason = `Declared family ${declaredFamily} resolved as ${resolvedFamily}`;
  } else if (metricStatus === 'fail' || observation.fontCheck === false) {
    state = 'failed';
    reason = metricStatus === 'fail' ? 'Font metric delta exceeded the failure threshold' : 'Declared font check failed';
  } else {
    state = 'resolved';
    if (metricStatus === 'warn') reason = 'Font metric delta exceeded the warning threshold';
  }

  return {
    state,
    profile,
    declaredFamily,
    resolvedFamily,
    declaredWeight: profile.weight,
    resolvedWeight: observation.resolvedWeight,
    fontSize: observation.fontSize,
    lineHeight: observation.lineHeight,
    domMetrics: {
      scrollWidth: observation.scrollWidth,
      clientWidth: observation.clientWidth,
      scrollHeight: observation.scrollHeight,
      clientHeight: observation.clientHeight,
    },
    fontChecks: observation.fontChecks,
    weightState,
    fallbackUsed,
    metricStatus,
    maxMetricDelta,
    metricDeltas: { width: widthDelta, height: heightDelta, canvas: canvasDelta },
    reason,
  };
}

export function createFontProfile(
  family: string,
  weight: number | string = 400,
  options?: Pick<FontProfile, 'language' | 'source'>,
): FontProfile {
  const families = family.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return {
    declaredFamily: families[0] || 'system-ui',
    fallbackStack: families.slice(1),
    weight,
    ...options,
  };
}

function profileFromFamily(family: string): FontProfile {
  const profile = createFontProfile(family, 400, { source: 'computed-style' });
  return profile;
}

export async function checkFontAndIcons(page: Page, profile?: FontProfile): Promise<FontIconCheckResult> {
  const raw = await page.evaluate((input: FontCollectionProfile | undefined): RawFontIconData => {
    const fontFamilySet = new Set<string>();
    const fontSizeSet = new Set<number>();
    const iconStyleSet = new Set<string>();
    const all = Array.from(document.body.querySelectorAll<HTMLElement>('*'));
    const visible = all.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    const firstText = visible.find((el) => (el.textContent || '').trim().length > 0);
    const firstStyle = firstText ? window.getComputedStyle(firstText) : undefined;
    const computedFamily = firstStyle?.fontFamily || input?.declaredFamily || 'system-ui';
    const declaredFamily = input?.declaredFamily || computedFamily.split(',')[0].trim().replace(/['"]/g, '');
    const declaredWeight = input?.weight ?? Number(firstStyle?.fontWeight || 400);
    const fonts = (document as Document & {
      fonts?: { check?: (font: string, text?: string) => boolean };
    }).fonts;
    const fontsApiAvailable = Boolean(fonts && typeof fonts.check === 'function');
    const checkedWeights = new Set<string>([String(declaredWeight)]);
    for (const el of visible) {
      const weight = window.getComputedStyle(el).fontWeight;
      if (weight) checkedWeights.add(weight);
    }
    const fontChecks: Record<string, boolean> = {};
    if (fontsApiAvailable) {
      for (const weight of checkedWeights) {
        fontChecks[weight] = fonts!.check!(`${weight} 16px ${declaredFamily}`, 'BESbswy');
      }
    }
    const fontCheck = fontsApiAvailable
      ? Object.values(fontChecks).every(Boolean)
      : undefined;

    const resolvedFamily = firstStyle?.fontFamily?.split(',')[0].trim().replace(/['"]/g, '') || '';
    const resolvedWeight: number | string | undefined = firstStyle?.fontWeight || undefined;
    let fontSize: number | undefined;
    let lineHeight: number | undefined;
    let baselineWidth: number | undefined;
    let baselineHeight: number | undefined;
    let scrollWidth: number | undefined;
    let clientWidth: number | undefined;
    let scrollHeight: number | undefined;
    let clientHeight: number | undefined;
    let canvasWidthDelta = 0;
    let canvasHeightDelta = 0;

    if (firstText && firstStyle) {
      fontSize = parseFloat(firstStyle.fontSize);
      lineHeight = firstStyle.lineHeight === 'normal' ? undefined : parseFloat(firstStyle.lineHeight);
      scrollWidth = firstText.scrollWidth;
      clientWidth = firstText.clientWidth;
      scrollHeight = firstText.scrollHeight;
      clientHeight = firstText.clientHeight;
      const text = (firstText.textContent || '').trim().slice(0, 500);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context && Number.isFinite(fontSize)) {
        const resolvedFont = `${firstStyle.fontWeight} ${fontSize}px ${firstStyle.fontFamily}`;
        context.font = `${declaredWeight} ${fontSize}px ${declaredFamily}`;
        const declaredWidth = context.measureText(text).width;
        context.font = resolvedFont;
        const resolvedWidth = context.measureText(text).width;
        baselineWidth = declaredWidth;
        baselineHeight = lineHeight || fontSize;
        canvasWidthDelta = Math.abs(resolvedWidth - declaredWidth) / Math.max(declaredWidth, 1);
        canvasHeightDelta = 0;
      }
    }

    function collectStyles(): void {
      for (const el of visible) {
        const style = window.getComputedStyle(el);
        const family = (style.fontFamily || '').split(',')[0].trim().replace(/['"]/g, '');
      if (family) fontFamilySet.add(family);

      const sizeMatch = (style.fontSize || '').match(/([\d.]+)px/);
      if (sizeMatch) {
        const px = parseFloat(sizeMatch[1]);
        if (!Number.isNaN(px)) fontSizeSet.add(Math.round(px * 10) / 10);
      }

      const classNames = el.className && typeof el.className === 'string' ? el.className : '';
      const hasIconClass =
        /(^|[\s-])icon(s)?([\s-]|$)/i.test(classNames) ||
        /\bfa[srbldc]?\b/.test(classNames) ||
        /\bmaterial-icons\b/.test(classNames) ||
        /\blucide\b/.test(classNames) ||
        /\bbi\b/.test(classNames);
      const hasDataIcon = el.hasAttribute('data-icon');
      const isSvg = el.tagName.toLowerCase() === 'svg';
      const isEmoji =
        el.textContent &&
        /\p{Emoji_Presentation}/u.test(el.textContent) &&
        el.textContent.trim().length <= 4;

      if (hasIconClass || hasDataIcon || isSvg || isEmoji) {
        const explicit = el.getAttribute('data-icon-style');
        if (explicit) {
          iconStyleSet.add(explicit);
        } else if (isSvg) {
          const strokeWidth = el.getAttribute('stroke-width') || style.strokeWidth;
          const hasFill = style.fill && style.fill !== 'none' && style.fill !== 'rgba(0, 0, 0, 0)';
          const hasStroke = style.stroke && style.stroke !== 'none' && parseFloat(strokeWidth) > 0;
          if (hasStroke && !hasFill) iconStyleSet.add('linear');
          else if (hasFill) iconStyleSet.add('solid');
          else iconStyleSet.add('linear');
        } else if (isEmoji) {
          iconStyleSet.add('emoji');
        } else if (classNames) {
          if (/\b(solid|fas|filled)\b/.test(classNames)) iconStyleSet.add('solid');
          else if (/\b(regular|far|line|linear|outline|outlined)\b/.test(classNames)) iconStyleSet.add('linear');
          else iconStyleSet.add('solid');
        }
      }
      }
    }
    collectStyles();

    const layoutProfile = document.documentElement.getAttribute('data-layout-profile')
      || document.body.getAttribute('data-layout-profile')
      || undefined;
    return {
      fontFamilies: Array.from(fontFamilySet),
      fontSizes: Array.from(fontSizeSet).sort((a, b) => a - b),
      iconStyles: Array.from(iconStyleSet),
      observation: {
        fontsApiAvailable,
        fontCheck,
        fontChecks,
        resolvedFamily,
        resolvedWeight,
        fontSize,
        lineHeight,
        baselineWidth,
        baselineHeight,
        scrollWidth,
        clientWidth,
        scrollHeight,
        clientHeight,
        canvasWidthDelta,
        canvasHeightDelta,
      },
      layoutProfile,
    };
  }, profile ? {
    declaredFamily: profile.declaredFamily,
    fallbackStack: profile.fallbackStack,
    weight: profile.weight,
  } : undefined);

  const effectiveProfile = profile || profileFromFamily(raw.observation.resolvedFamily);
  const font = classifyFontObservation(raw.observation, effectiveProfile);
  return {
    fontFamilyCount: raw.fontFamilies.length,
    fontFamilies: raw.fontFamilies,
    fontSizeLevels: raw.fontSizes.length,
    fontSizes: raw.fontSizes,
    iconStyles: raw.iconStyles,
    iconStyleConsistent: raw.iconStyles.length <= 1,
    font,
    layoutProfile: raw.layoutProfile,
  };
}
