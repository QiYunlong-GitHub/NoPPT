// 参考文件属性优先级解析（Task 1 / FR-0 / FR-3 / FR-4 / C-15）
// 纯函数模块，无私有方法，便于 Vitest 直接 import 测试（不依赖 agent 实例）。
import {
  pageTypeToCategory,
  ReferenceVisualAttributes,
  ReferenceVisualFeatures,
} from '../../types';

// ---------- 9 个三级优先级 resolve 函数（ref 优先 → user → default）----------

/**
 * 从参考属性解析「本页参考构图」：仅分类显式上传 → 或 content 分类的 global 定向兜底。
 * 供封面/标题页模板选择与后处理构图护栏共用。
 * 注意：已按「结构层分发门控」修正——单份 global 仅 content 分类可继承其构图，
 * cover/summary 不会继承 global 构图（避免内容参考的左对齐污染封面）。
 */
export function resolveReferenceComposition(
  attrs: ReferenceVisualAttributes | null | undefined,
  pageType: string,
): 'left-aligned' | 'centered' | 'unknown' {
  if (!attrs) return 'unknown';
  const cat = pageTypeToCategory(pageType);
  const cr = attrs.byCategory?.[cat];
  const fromVisual = (
    v?: ReferenceVisualFeatures | null,
  ): 'left-aligned' | 'centered' | undefined => {
    if (!v?.composition) return undefined;
    return v.composition === 'left-aligned' || v.composition === 'centered'
      ? v.composition
      : undefined;
  };
  const fromVerbal = (
    s?: { layoutVerbal?: string } | null,
  ): 'left-aligned' | 'centered' | undefined => {
    const t = s?.layoutVerbal || '';
    if (/左对齐/.test(t)) return 'left-aligned';
    if (/居中/.test(t)) return 'centered';
    return undefined;
  };
  // 仅「分类显式上传」提供构图（避免单份 global 污染 cover/summary）
  if (cr?.uploaded) {
    const c = fromVisual(cr.visual) || fromVerbal(cr.structure) || undefined;
    if (c) return c;
  }
  // content 分类允许 global 单份定向兜底
  if (cat === 'content' && attrs.global?.uploaded) {
    const g = fromVisual(attrs.global.visual) || fromVerbal(attrs.global.structure) || undefined;
    if (g) return g;
  }
  return 'unknown';
}


// ---------- 日志工具（FR-7）----------
export function formatPriorityDecision(
  attr: string,
  ref: unknown,
  user: unknown,
  final: unknown,
  source: string,
): string {
  return `[PRI] attr=${attr} ref=${JSON.stringify(ref)} user=${JSON.stringify(
    user,
  )} final=${JSON.stringify(final)} source=${source}`;
}


// ---------- 参考图视觉特征 → 自然语言指引（FR-2.x）----------
export const VISUAL_LABELS: Partial<Record<keyof ReferenceVisualFeatures, Record<string, string>>> = {
  composition: {
    centered: '居中构图',
    'left-aligned': '左对齐构图',
    split: '分栏构图',
    'full-bleed': '全幅构图',
  },
  columns: { '1': '1 栏', '2': '2 栏', '3': '3 栏', '4': '4 栏' },
  titleScale: { poster: '海报级标题', large: '大号标题', normal: '常规标题' },
  decoration: {
    'gradient-glow': '渐变光晕装饰',
    'geometric-shapes': '几何形状装饰',
    'thin-lines': '细线条装饰',
    'solid-blocks': '实色块装饰',
    minimal: '极简装饰',
  },
  backgroundTone: { light: '浅色背景', dark: '深色背景', colored: '彩色背景' },
  cardRadius: { none: '无圆角', small: '小圆角', large: '大圆角' },
  imagery: { photo: '照片调性', illustration: '插画调性', icon: '图标调性', none: '无图' },
};


/** 将七维视觉特征转为「、」分隔的中文指引；无特征返回 undefined。 */
export function describeVisualFeatures(visual?: ReferenceVisualFeatures): string | undefined {
  if (!visual) return undefined;
  const segs: string[] = [];
  const pick = (map: Record<string, string> | undefined, v: unknown) => {
    if (!map || v === undefined) return;
    if (map[String(v)]) segs.push(map[String(v)]);
  };
  pick(VISUAL_LABELS.composition, visual.composition);
  pick(VISUAL_LABELS.columns, visual.columns);
  pick(VISUAL_LABELS.titleScale, visual.titleScale);
  pick(VISUAL_LABELS.decoration, visual.decoration);
  pick(VISUAL_LABELS.backgroundTone, visual.backgroundTone);
  pick(VISUAL_LABELS.cardRadius, visual.cardRadius);
  pick(VISUAL_LABELS.imagery, visual.imagery);
  return segs.length ? segs.join('、') : undefined;
}

// ---------- FR-参考克隆：结构层 / 风格层 分发门控 ----------

