import {
  Sparkles,
  Monitor,
  Download,
  Edit3,
  Database,
  Info,
  Sun,
  Moon,
  Globe,
  Grid3X3,
  Brain,
  Zap,
  Layers,
  Layout,
  ScrollText,
} from 'lucide-react';

export type SectionId = 'ai-model' | 'interface' | 'export' | 'editor' | 'logs' | 'data' | 'about';

export const sections = [
  { id: 'ai-model' as SectionId, label: 'AI 模型', icon: Sparkles },
  { id: 'interface' as SectionId, label: '界面设置', icon: Monitor },
  { id: 'export' as SectionId, label: '导出设置', icon: Download },
  { id: 'editor' as SectionId, label: '编辑器', icon: Edit3 },
  { id: 'logs' as SectionId, label: '日志配置', icon: ScrollText },
  { id: 'data' as SectionId, label: '数据管理', icon: Database },
  { id: 'about' as SectionId, label: '关于', icon: Info },
];

export const modelProviders = [
  { value: 'openai', label: 'OpenAI 兼容接口', icon: Brain, hint: '支持 GPT、DeepSeek、Qwen 等' },
  {
    value: 'anthropic',
    label: 'Anthropic 兼容接口',
    icon: Brain,
    hint: 'Claude 3.5 / Claude 4 系列',
  },
  { value: 'freeai', label: 'Free.ai (380+ 模型)', icon: Zap, hint: '免费额度，聚合 380+ 模型' },
  {
    value: 'v0',
    label: 'v0 by Vercel (UI 生成)',
    icon: Layers,
    hint: '高保真 UI 生成，React/Tailwind',
  },
  { value: 'ollama', label: 'Ollama (本地模型)', icon: Layout, hint: '完全离线，数据不出本机' },
  {
    value: 'company-gateway',
    label: '公司 API 网关',
    icon: Layout,
    hint: '企业内网大模型服务网关',
  },
];

export const imageProviders = [
  { value: 'openai', label: 'OpenAI', icon: Sparkles, hint: 'DALL·E 3 / DALL·E 2' },
  { value: 'qwen', label: '阿里云百炼', icon: Zap, hint: 'Qwen-Image / Wanx 系列' },
  { value: 'seedream', label: '字节火山引擎', icon: Sparkles, hint: 'Seedream 系列模型' },
  { value: 'freeai', label: 'Free.ai (380+ 模型)', icon: Zap, hint: '免费额度，flux-dev 等' },
  { value: 'ollama', label: 'Ollama (本地模型)', icon: Layout, hint: '完全离线，数据不出本机' },
  {
    value: 'company-gateway',
    label: '公司 API 网关',
    icon: Layout,
    hint: '企业内网文生图服务网关',
  },
];

export const themeOptions = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'auto', label: '跟随系统', icon: Monitor },
];

export const languageOptions = [
  { value: 'zh-CN', label: '简体中文', icon: Globe },
  { value: 'en', label: 'English', icon: Globe },
];

export const exportFormatOptions = [
  { value: 'html', label: 'HTML', desc: '可交互网页' },
  { value: 'pdf', label: 'PDF', desc: '文档格式' },
  { value: 'png', label: 'PNG', desc: '图片序列' },
];

export const pdfQualityOptions = [
  { value: 'low', label: '低质量', size: '文件更小' },
  { value: 'medium', label: '中等', size: '平衡' },
  { value: 'high', label: '高质量', size: '文件更大' },
];

export const slideSizePresets = [
  { label: '16:9', w: 1280, h: 720 },
  { label: '4:3', w: 1024, h: 768 },
  { label: '1:1', w: 800, h: 800 },
  { label: '9:16', w: 720, h: 1280 },
];

export const quickModelOptions: Record<string, Array<{ label: string; value: string }>> = {
  freeai: [
    { label: 'Qwen 7B (免费)', value: 'qwen7b' },
    { label: 'Qwen Coder', value: 'qwen-coder' },
    { label: 'DeepSeek V3', value: 'deepseek-v3' },
    { label: 'GPT-4o Mini', value: 'openai/gpt-4o-mini' },
    { label: 'GPT-4o', value: 'openai/gpt-4o' },
    { label: 'Claude Sonnet 4', value: 'anthropic/claude-sonnet-4' },
    { label: 'Gemini Flash', value: 'google/gemini-2.0-flash' },
  ],
  v0: [
    { label: 'v0 1.5 MD (平衡)', value: 'v0-1.5-md' },
    { label: 'v0 1.5 XL (高质量)', value: 'v0-1.5-xl' },
    { label: 'v0 Turbo (快速)', value: 'v0-turbo' },
  ],
};
