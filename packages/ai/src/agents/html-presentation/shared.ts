/**
 * HTMLPresentationAgent 顶层纯工具/常量层（二次拆分后的聚合 barrel）。
 * 原文件通过 `export * from './html-presentation/shared'` 再导出，对外具名导出保持不变。
 */

export * from './types';
export * from './constants';
export * from './color';
export * from './retry-budget';
export * from './primary-color';
export * from './image-sizing';
export * from './structure-parser';

