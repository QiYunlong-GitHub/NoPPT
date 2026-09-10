export type PropertyType = 'number' | 'color' | 'select' | 'text' | 'composite';

export interface PropertyDescriptor {
  key: string;
  label: string;
  type: PropertyType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number;
  options?: Array<{ label: string; value: string }>;
  category?: string;
  dependsOn?: string;
}

export const PROPERTY_CATEGORIES = {
  POSITION: 'position',
  TYPOGRAPHY: 'typography',
  BACKGROUND: 'background',
  BORDER: 'border',
  SHADOW: 'shadow',
  EFFECTS: 'effects',
} as const;

export const FONT_FAMILY_OPTIONS = [
  { value: 'Microsoft YaHei, 微软雅黑, sans-serif', label: '微软雅黑' },
  { value: 'SimSun, 宋体, serif', label: '宋体' },
  { value: 'SimHei, 黑体, sans-serif', label: '黑体' },
  { value: 'KaiTi, 楷体, serif', label: '楷体' },
  { value: 'FangSong, 仿宋, serif', label: '仿宋' },
  { value: 'NSimSun, 新宋体, serif', label: '新宋体' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'system-ui, sans-serif', label: '系统默认' },
];

export const BORDER_STYLE_OPTIONS = [
  { label: '实线', value: 'solid' },
  { label: '虚线', value: 'dashed' },
  { label: '点线', value: 'dotted' },
  { label: '双线', value: 'double' },
  { label: '无', value: 'none' },
];

export const FONT_WEIGHT_OPTIONS = [
  { label: '常规', value: '400' },
  { label: '加粗', value: '700' },
];

export const FONT_STYLE_OPTIONS = [
  { label: '常规', value: 'normal' },
  { label: '斜体', value: 'italic' },
];

export const TEXT_ALIGN_OPTIONS = [
  { label: '左对齐', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '右对齐', value: 'right' },
  { label: '两端对齐', value: 'justify' },
];

export const propertyDescriptors: PropertyDescriptor[] = [
  {
    key: 'left',
    label: 'X 位置',
    type: 'number',
    unit: 'px',
    min: 0,
    step: 1,
    category: PROPERTY_CATEGORIES.POSITION,
  },
  {
    key: 'top',
    label: 'Y 位置',
    type: 'number',
    unit: 'px',
    min: 0,
    step: 1,
    category: PROPERTY_CATEGORIES.POSITION,
  },
  {
    key: 'width',
    label: '宽度',
    type: 'number',
    unit: 'px',
    min: 10,
    step: 1,
    category: PROPERTY_CATEGORIES.POSITION,
  },
  {
    key: 'height',
    label: '高度',
    type: 'number',
    unit: 'px',
    min: 10,
    step: 1,
    category: PROPERTY_CATEGORIES.POSITION,
  },
  {
    key: 'rotation',
    label: '旋转',
    type: 'number',
    unit: 'deg',
    min: -360,
    max: 360,
    step: 1,
    defaultValue: 0,
    category: PROPERTY_CATEGORIES.POSITION,
  },

  {
    key: 'fontSize',
    label: '字号',
    type: 'number',
    unit: 'px',
    min: 8,
    max: 200,
    step: 1,
    defaultValue: 16,
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'fontFamily',
    label: '字体',
    type: 'select',
    options: FONT_FAMILY_OPTIONS,
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'fontWeight',
    label: '字重',
    type: 'select',
    options: FONT_WEIGHT_OPTIONS,
    defaultValue: '400',
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'fontStyle',
    label: '字体样式',
    type: 'select',
    options: FONT_STYLE_OPTIONS,
    defaultValue: 'normal',
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'textDecoration',
    label: '文字装饰',
    type: 'composite',
    defaultValue: 'none',
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'color',
    label: '文字颜色',
    type: 'color',
    defaultValue: '#000000',
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'textAlign',
    label: '对齐方式',
    type: 'select',
    options: TEXT_ALIGN_OPTIONS,
    defaultValue: 'left',
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'lineHeight',
    label: '行高',
    type: 'number',
    unit: '',
    min: 0.5,
    max: 5,
    step: 0.1,
    defaultValue: 1.5,
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },
  {
    key: 'letterSpacing',
    label: '字间距',
    type: 'number',
    unit: 'px',
    min: -10,
    max: 50,
    step: 0.5,
    defaultValue: 0,
    category: PROPERTY_CATEGORIES.TYPOGRAPHY,
  },

  {
    key: 'backgroundColor',
    label: '背景颜色',
    type: 'color',
    defaultValue: '#ffffff',
    category: PROPERTY_CATEGORIES.BACKGROUND,
  },
  {
    key: 'backgroundImage',
    label: '背景图片',
    type: 'composite',
    category: PROPERTY_CATEGORIES.BACKGROUND,
  },
  {
    key: 'opacity',
    label: '不透明度',
    type: 'number',
    unit: '',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 1,
    category: PROPERTY_CATEGORIES.BACKGROUND,
  },

  {
    key: 'borderRadius',
    label: '圆角',
    type: 'number',
    unit: 'px',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    category: PROPERTY_CATEGORIES.BORDER,
  },
  {
    key: 'borderWidth',
    label: '边框粗细',
    type: 'number',
    unit: 'px',
    min: 0,
    max: 20,
    step: 1,
    defaultValue: 0,
    category: PROPERTY_CATEGORIES.BORDER,
  },
  {
    key: 'borderStyle',
    label: '边框样式',
    type: 'select',
    options: BORDER_STYLE_OPTIONS,
    defaultValue: 'solid',
    category: PROPERTY_CATEGORIES.BORDER,
    dependsOn: 'borderWidth',
  },
  {
    key: 'borderColor',
    label: '边框颜色',
    type: 'color',
    defaultValue: '#e2e8f0',
    category: PROPERTY_CATEGORIES.BORDER,
    dependsOn: 'borderWidth',
  },

  {
    key: 'boxShadow',
    label: '阴影',
    type: 'composite',
    category: PROPERTY_CATEGORIES.SHADOW,
  },

  {
    key: 'transform',
    label: '变换',
    type: 'composite',
    category: PROPERTY_CATEGORIES.EFFECTS,
  },
  {
    key: 'filter',
    label: '滤镜',
    type: 'composite',
    category: PROPERTY_CATEGORIES.EFFECTS,
  },
];

export const propertyDescriptorMap: Record<string, PropertyDescriptor> = propertyDescriptors.reduce(
  (acc, descriptor) => {
    acc[descriptor.key] = descriptor;
    return acc;
  },
  {} as Record<string, PropertyDescriptor>,
);

export function getDescriptorsByCategory(category: string): PropertyDescriptor[] {
  return propertyDescriptors.filter((d) => d.category === category);
}

export function getDescriptor(key: string): PropertyDescriptor | undefined {
  return propertyDescriptorMap[key];
}
