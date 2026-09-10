export type ID = string;

export type ElementType =
  'text' | 'image' | 'shape' | 'chart' | 'table' | 'video' | 'divider' | 'group';

export type ShapeType = 'rect' | 'circle' | 'triangle' | 'line' | 'arrow';

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'column';

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export type FontWeight = 'normal' | 'bold' | 'lighter' | 'bolder';

export type FontStyle = 'normal' | 'italic';

export type TextDecoration = 'none' | 'underline' | 'line-through';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Position, Size {}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ColorStop {
  color: string;
  offset: number;
}

export interface Gradient {
  type: 'linear' | 'radial';
  angle?: number;
  stops: ColorStop[];
}

export type BackgroundFill = string | Gradient;

export interface BorderStyle {
  width: number;
  style: 'solid' | 'dashed' | 'dotted' | 'none';
  color: string;
  radius?: number;
}

export interface ShadowStyle {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  fontStyle?: FontStyle;
  textDecoration?: TextDecoration;
  color?: string;
  textAlign?: TextAlign;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface AnimationConfig {
  type: 'fade' | 'slide' | 'zoom' | 'bounce' | 'none';
  duration: number;
  delay: number;
  direction?: 'left' | 'right' | 'top' | 'bottom';
}

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

export interface ThemeTypography {
  fontFamily: string;
  headingFontFamily: string;
  baseFontSize: number;
  headingSizes: {
    h1: number;
    h2: number;
    h3: number;
    h4: number;
  };
}

export interface ThemeConfig {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  typography: ThemeTypography;
  borderRadius: number;
  shadow: string;
}

export type PresentationType = 'presentation' | 'document' | 'webpage';

export interface PresentationMeta {
  id: string;
  title: string;
  description?: string;
  author?: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  tags?: string[];
  type: PresentationType;
}

export interface HistoryState {
  past: string[];
  future: string[];
}
