/**
 * shared.ts 二次拆分产出：类型与接口定义（无依赖，最底层）
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { DesignProposal, ImagePreference, ImageRatio, PresentationPlan, SlidePageType } from '../../types';

export interface SlideElement {
  id: string;
  type:
    | 'heading'
    | 'paragraph'
    | 'list'
    | 'image'
    | 'card'
    | 'decoration'
    | 'table'
    | 'button'
    | 'other';
  tag: string;
  label: string;
  selector?: string;
}


export interface HTMLSlide {
  title: string;
  html: string;
  notes?: string;
  imagePrompt?: string;
  imageRatio?: ImageRatio;
  pageType?: SlidePageType;
  elements?: SlideElement[];
  /** 逐页配图偏好（规划阶段归一化后的落盘值，可能区别于全局 imagePreference） */
  imagePreference?: ImagePreference;
  /** 该页在 plan.slides 中的原始下标，用于回查 slidePlan */
  _originalIdx?: number;
  critique?: {
    score: number;
    passed: boolean;
    attempts: number;
    issues: string[];
  };
}


export interface GenerationTiming {
  startTime: string;
  endTime: string;
  durationMs: number;
}


export interface HTMLPresentation {
  title: string;
  description?: string;
  primaryColor?: string;
  transition?: string;
  slides: HTMLSlide[];
  timing?: GenerationTiming;
  width?: number;
  height?: number;
  imagePreference?: ImagePreference;
  plan?: PresentationPlan;
  design?: DesignProposal;
}


export type RetryEntry = { total: number; byChannel: Record<string, number> };

export interface PixelRange {
  minPixels: number;
  maxPixels: number;
  label?: string;
}
/**
 * 给定目标比例（如 21:9 = 2.333）+ 像素允许范围，自动算出符合比例、
 * 落在像素范围内、且 w/h 能被 ALIGN=32 整除（主流扩散模型尺寸对齐要求）的 (w, h)。
 * 选像素量最接近 range 中点的值，以保证细节。
 */

export interface CandidateModel {
  modelName: string;
  sizes: Array<{ width: number; height: number; label?: string }>;
  pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>;
  index: number;
}


export type SlideCountSpec =
  | { exact: number; min?: undefined; max?: undefined }
  | { min: number; max: number; exact?: undefined };

/**
 * 用户显式结构指令（优先级高于页数策略）
 */

export type PageStructureHints = {
  /** 只生成内容页 → 封面/目录/总结都不要 */
  contentOnly: boolean;
  /** 不生成封面页 */
  disableCover: boolean;
  /** 不生成目录页 */
  disableToc: boolean;
  /** 不生成总结/结束页 */
  disableConclusion: boolean;
};

/**
 * 从主题文本中提取用户显式的结构禁用指令。
 * 支持关键词包括：
 *   只生成内容页 → contentOnly=true（覆盖所有开关）
 *   不生成封面页 / 不要封面 / 跳过封面 / 不要封面页 → disableCover
 *   不生成目录页 / 不要目录 / 不要目录页 / 跳过目录 → disableToc
 *   不生成总结页 / 不要总结 / 不要结束页 / 不要总结页 / 跳过总结 / 不要结语 / 不要结尾 / 不要最后一页 → disableConclusion
 */
