/**
 * AIGenerateModal 的生成流程枚举类型（由 AIGenerateModal.tsx 外置）。
 * 单独成文件是为了让 Stepper / HtmlPreview / useGenerateState 等模块
 * 可以引用它们而不与主组件产生循环依赖。
 */
export type PipelineStage = 'config' | 'outline' | 'design' | 'layout-preview' | 'generating' | 'done';
export type CollabMode = 'auto' | 'guided' | 'collaborative';
export type Density = 'compact' | 'normal' | 'spacious';
export type ImagePref = 'all' | 'content-only' | 'minimal' | 'none';
export type ColorTheme = 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'gray';
export type SlideCountMode = 'auto' | 'exact' | 'range';
export type FontFamily = 'sans' | 'serif' | 'mono';
