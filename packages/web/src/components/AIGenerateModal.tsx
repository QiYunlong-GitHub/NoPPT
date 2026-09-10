import { t } from '@/i18n';
import { useState, useRef, useEffect } from 'react';
import {
  X,
  Sparkles,
  FileCode,
  FileImage,
  ChevronDown,
  ChevronUp,
  Settings2,
  Edit3,
  ListChecks,
  ArrowLeft,
  RefreshCw,
  Check,
  Zap,
  Target,
  Users,
  Image as ImageIcon,
  Database,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';
import { usePresentationStore } from '@/stores/presentation';
import { aiApi } from '@/utils/api';
import { formatBeijingTime, formatClockTime } from '@/utils';
import { safeHtml } from '@/utils/security';
import { DEFAULT_SLIDE_COUNT, referenceTextLimit } from '@/utils/referenceTextLimit';
import { LayoutEngine } from '@noppt/core';
import type {
  PresentationPlan,
  SlidePlan,
  DesignProposal,
  RenderedSlide,
  IconStyle,
} from '@noppt/ai';
type Density = 'compact' | 'normal' | 'spacious';
type ImagePref = 'all' | 'content-only' | 'minimal' | 'none';
type ColorTheme = 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'gray';
type SlideCountMode = 'auto' | 'exact' | 'range';
type FontFamily = 'sans' | 'serif' | 'mono';
type PipelineStage = 'config' | 'outline' | 'design' | 'layout-preview' | 'generating' | 'done';
type CollabMode = 'auto' | 'guided' | 'collaborative';
/** 预填参数白名单：草稿里带过来的枚举值需在前端合法才落位。 */
const COLOR_THEME_IDS = ['blue', 'purple', 'green', 'orange', 'teal', 'gray'] as const;
const ICON_STYLE_IDS = [
  'auto',
  'line',
  'filled',
  'numbered',
  'bullet',
  'lettered',
  'emoji',
  'none',
] as const;
const audienceOptions: {
  id: string;
  name: string;
  desc: string;
}[] = [
  { id: '通用商务受众', name: '通用商务', desc: t('跨行业通用') },
  { id: '技术研发团队 / 工程师', name: '技术人员', desc: t('工程师/研发') },
  { id: '公司管理层 / 决策者', name: '管理层', desc: t('老板/总监') },
  { id: '投资人 / 股东', name: '投资人', desc: t('融资/路演') },
  { id: '学生 / 教育场景', name: '学生/教育', desc: t('课堂/作业') },
  { id: '销售市场团队 / 客户', name: '销售市场', desc: t('营销/提案') },
];
const fontFamilyOptions: {
  id: FontFamily;
  name: string;
  desc: string;
}[] = [
  { id: 'sans', name: '无衬线体', desc: t('现代商务风（推荐）') },
  { id: 'serif', name: '衬线体', desc: t('典雅学术风') },
  { id: 'mono', name: '等宽体', desc: t('技术极客风') },
];
const colorThemeOptions: {
  id: ColorTheme;
  name: string;
  color: string;
}[] = [
  { id: 'blue', name: '商务蓝', color: '#2563eb' },
  { id: 'purple', name: '创意紫', color: '#7c3aed' },
  { id: 'teal', name: '科技青', color: '#0891b2' },
  { id: 'green', name: '自然绿', color: '#059669' },
  { id: 'orange', name: '活力橙', color: '#ea580c' },
  { id: 'gray', name: '极简灰', color: '#4b5563' },
];
const iconStyleOptions: {
  id: IconStyle;
  name: string;
  desc: string;
}[] = [
  { id: 'auto', name: '智能匹配', desc: t('默认线性，专业简约') },
  { id: 'line', name: '线性图标', desc: t('描边风格，B端/技术首选') },
  { id: 'filled', name: '面性图标', desc: t('实心填充，重点/封面') },
  { id: 'numbered', name: '数字序号', desc: '1 2 3 4' },
  { id: 'bullet', name: '对勾/圆点', desc: '✓ ● ✓ ●' },
  { id: 'lettered', name: '字母分类', desc: 'A B C D' },
  { id: 'emoji', name: 'Emoji', desc: t('🎯 📊 ⚡ 💡') },
  { id: 'none', name: '无图标', desc: t('纯文字') },
];
function getPageTypeLabel(pageType: string): string {
  if (pageType === 'cover') return t('封面');
  if (pageType === 'toc') return t('目录');
  if (pageType.startsWith('content-')) return t('内容');
  if (pageType === 'summary' || pageType === 'conclusion') return t('总结');
  return t('页面');
}
const modeOptions: {
  id: CollabMode;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
}[] = [
  {
    id: 'auto',
    icon: <Zap className="w-5 h-5" />,
    title: t('全自动'),
    desc: t('一键生成，最快出稿'),
  },
  {
    id: 'guided',
    icon: <Target className="w-5 h-5" />,
    title: t('引导式'),
    desc: t('关键节点确认，防返工'),
    badge: '推荐',
  },
  {
    id: 'collaborative',
    icon: <Users className="w-5 h-5" />,
    title: t('协作式'),
    desc: t('逐页审核，精雕细琢'),
  },
];
function Stepper({ currentStage }: { currentStage: PipelineStage }) {
  const steps = [
    { key: 'outline', label: t('大纲') },
    { key: 'design', label: t('设计方案') },
    { key: 'layout-preview', label: t('页面预览') },
    { key: 'generating', label: t('生成') },
  ];
  const stageOrder: PipelineStage[] = ['outline', 'design', 'layout-preview', 'generating', 'done'];
  const currentIdx = stageOrder.indexOf(currentStage);
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-4">
      {steps.map((s, i) => {
        const stepIdx = stageOrder.indexOf(s.key as PipelineStage);
        const isDone = currentIdx > stepIdx || currentStage === 'done';
        const isCurrent = currentStage === s.key;
        return (
          <div key={s.key} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isDone
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : isCurrent
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-700/50 dark:text-slate-500'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                  isDone
                    ? 'bg-green-500 text-white'
                    : isCurrent
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-300 dark:bg-slate-600 text-white'
                }`}
              >
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-4 sm:w-8 h-0.5 rounded ${isDone ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-700'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
function HtmlPreview({
  html,
  scale,
  width = 1280,
  height = 720,
  fit = false,
}: {
  html: string;
  scale?: number;
  width?: number;
  height?: number;
  fit?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScale, setAutoScale] = useState(0.25);
  useEffect(() => {
    if (!fit || !containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setAutoScale(w / width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, width]);
  const effectiveScale = fit ? autoScale : (scale ?? 0.25);
  return (
    <div
      ref={containerRef}
      className="overflow-hidden relative bg-white"
      style={
        fit
          ? { width: '100%', aspectRatio: `${width} / ${height}` }
          : { width: width * effectiveScale, height: height * effectiveScale }
      }
    >
      <div
        style={{
          width,
          height,
          transform: `scale(${effectiveScale})`,
          transformOrigin: 'top left',
        }}
        dangerouslySetInnerHTML={safeHtml(html)}
      />
    </div>
  );
}
export default function AIGenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  const consumeAIPrefill = useUIStore((s) => s.consumeAIPrefill);
  const settings = useSettingsStore();
  const presentation = usePresentationStore((s) => s.presentation);
  const setPresentation = usePresentationStore((s) => s.setPresentation);
  const savePresentation = usePresentationStore((s) => s.savePresentation);
  const addChatMessage = usePresentationStore((s) => s.addChatMessage);
  const [topic, setTopic] = useState('');
  const [style, setStyle] = useState<'business' | 'creative' | 'simple' | 'academic'>('business');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [referenceHtml, setReferenceHtml] = useState<string | null>(null);
  const [referenceHtmlName, setReferenceHtmlName] = useState('');
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceImageName, setReferenceImageName] = useState('');
  // 分类参考（封面 / 内容 / 总结）：每组含 HTML + 图片 + 原图副本（Q7）
  const [referenceHtmlCover, setReferenceHtmlCover] = useState<string | null>(null);
  const [referenceHtmlCoverName, setReferenceHtmlCoverName] = useState('');
  const [referenceImageCover, setReferenceImageCover] = useState<string | null>(null);
  const [referenceImageCoverName, setReferenceImageCoverName] = useState('');
  const [referenceImageCoverOriginal, setReferenceImageCoverOriginal] = useState<string | null>(
    null,
  );
  const [referenceHtmlContent, setReferenceHtmlContent] = useState<string | null>(null);
  const [referenceHtmlContentName, setReferenceHtmlContentName] = useState('');
  const [referenceImageContent, setReferenceImageContent] = useState<string | null>(null);
  const [referenceImageContentName, setReferenceImageContentName] = useState('');
  const [referenceImageContentOriginal, setReferenceImageContentOriginal] = useState<string | null>(
    null,
  );
  const [referenceHtmlSummary, setReferenceHtmlSummary] = useState<string | null>(null);
  const [referenceHtmlSummaryName, setReferenceHtmlSummaryName] = useState('');
  const [referenceImageSummary, setReferenceImageSummary] = useState<string | null>(null);
  const [referenceImageSummaryName, setReferenceImageSummaryName] = useState('');
  const [referenceImageSummaryOriginal, setReferenceImageSummaryOriginal] = useState<string | null>(
    null,
  );
  // 跨步骤参考属性缓存版本号（由 plan 步骤返回，后续步骤原样回传）
  const [refAttrsVersion, setRefAttrsVersion] = useState<string | undefined>(undefined);
  // 镜像到 ref：buildGenerateParams 在 auto 模式同一 tick 内被同步调用，闭包捕获的 useState 值仍是旧值（undefined），
  // 必须用 ref 才能拿到 plan 刚返回的最新版本号（与 traceSessionIdRef 同款写法）。
  const refAttrsVersionRef = useRef<string | undefined>(undefined);
  // —— 参考素材（RAG / 对话上下文整理的「权威素材」）——
  // planning 阶段会作为「权威素材」段注入大纲 prompt（后端 GeneratePresentationRequest.referenceText）。
  const [referenceText, setReferenceText] = useState('');
  /** 素材来源标识（如「企业知识库 / RAG」），来自 Hermes 草稿，仅展示。 */
  const [referenceSource, setReferenceSource] = useState<string | undefined>(undefined);
  /** 草稿给出的素材上限（Hermes 侧按当时页数算得）；未预填时为 undefined，用本地公式派生。 */
  const [draftReferenceLimit, setDraftReferenceLimit] = useState<number | undefined>(undefined);
  const [referenceTruncated, setReferenceTruncated] = useState(false);
  const [referenceOriginalChars, setReferenceOriginalChars] = useState(0);
  /** 预填时的原始素材，供「恢复初始素材」使用。 */
  const [referenceInitial, setReferenceInitial] = useState('');
  const [showReference, setShowReference] = useState(false);
  // 同 refAttrsVersionRef：auto 模式同一 tick 内同步调用 buildGenerateParams，
  // 闭包捕获的 useState 仍是旧值，必须镜像到 ref 才能保证素材被带上。
  const referenceTextRef = useRef<string>('');
  /** 统一写入：state 与 ref 必须同步更新。 */
  const updateReferenceText = (value: string) => {
    referenceTextRef.current = value;
    setReferenceText(value);
  };
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [density, setDensity] = useState<Density>('normal');
  const [imagePreference, setImagePreference] = useState<ImagePref>('content-only');
  const [colorTheme, setColorTheme] = useState<ColorTheme | ''>('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [autoAuditEnabled, setAutoAuditEnabled] = useState<boolean>(
    () => settings.auditSettings?.enabled ?? true,
  );
  const [inlineSelfCheckEnabled, setInlineSelfCheckEnabled] = useState<boolean>(
    () => settings.inlineSelfCheckSettings?.enabled ?? true,
  );
  const [iconStyle, setIconStyle] = useState<IconStyle>('auto');
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>('auto');
  const [exactSlideCount, setExactSlideCount] = useState(8);
  const [minSlideCount, setMinSlideCount] = useState(5);
  const [maxSlideCount, setMaxSlideCount] = useState(10);
  const [audience, setAudience] = useState<string>(t('通用商务受众'));
  const [fontFamily, setFontFamily] = useState<FontFamily>('sans');
  // 生成语言：默认跟随界面语言；可单独指定中文/英文（透传至 AI agent）
  const [genLanguage, setGenLanguage] = useState<'follow' | 'zh-CN' | 'en'>('follow');
  const [stage, setStage] = useState<PipelineStage>('config');
  const [mode, setMode] = useState<CollabMode>('guided');
  const [plan, setPlan] = useState<PresentationPlan | null>(null);
  const [editableSlides, setEditableSlides] = useState<SlidePlan[]>([]);
  const [editableTitle, setEditableTitle] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [designProposals, setDesignProposals] = useState<DesignProposal[]>([]);
  const [selectedDesign, setSelectedDesign] = useState<DesignProposal | null>(null);
  const [renderedSlides, setRenderedSlides] = useState<RenderedSlide[]>([]);
  const [designLoading, setDesignLoading] = useState(false);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [approvedSlides, setApprovedSlides] = useState<boolean[]>([]);
  const [regeneratingSlides, setRegeneratingSlides] = useState<Set<number>>(new Set());
  const [expandedSlide, setExpandedSlide] = useState<number | null>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const traceSessionIdRef = useRef<string | null>(null);
  type ReferenceSlot = 'global' | 'cover' | 'content' | 'summary';
  type ReferenceKind = 'html' | 'image';
  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(t('读取失败')));
      reader.readAsText(file);
    });
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(t('读取失败')));
      reader.readAsDataURL(file);
    });
  // 复用原有图片压缩逻辑（最长边 ≤1024，JPEG 0.8）
  const compressImageDataUrl = (dataUrl: string, maxSize = 1024): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            } else {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          } else {
            resolve(dataUrl);
          }
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  // 各 slot 对应的状态写入器
  const setHtmlFor: Record<ReferenceSlot, (v: string | null) => void> = {
    global: setReferenceHtml,
    cover: setReferenceHtmlCover,
    content: setReferenceHtmlContent,
    summary: setReferenceHtmlSummary,
  };
  const setHtmlNameFor: Record<ReferenceSlot, (v: string) => void> = {
    global: setReferenceHtmlName,
    cover: setReferenceHtmlCoverName,
    content: setReferenceHtmlContentName,
    summary: setReferenceHtmlSummaryName,
  };
  const setImageFor: Record<ReferenceSlot, (v: string | null) => void> = {
    global: setReferenceImage,
    cover: setReferenceImageCover,
    content: setReferenceImageContent,
    summary: setReferenceImageSummary,
  };
  const setImageNameFor: Record<ReferenceSlot, (v: string) => void> = {
    global: setReferenceImageName,
    cover: setReferenceImageCoverName,
    content: setReferenceImageContentName,
    summary: setReferenceImageSummaryName,
  };
  const setImageOriginalFor: Record<'cover' | 'content' | 'summary', (v: string | null) => void> = {
    cover: setReferenceImageCoverOriginal,
    content: setReferenceImageContentOriginal,
    summary: setReferenceImageSummaryOriginal,
  };
  const applyReferenceHtml = (slot: ReferenceSlot, content: string, name: string) => {
    setHtmlFor[slot](content);
    setHtmlNameFor[slot](name);
  };
  const applyReferenceImage = (
    slot: ReferenceSlot,
    compressed: string,
    original: string,
    name: string,
  ) => {
    setImageFor[slot](compressed);
    setImageNameFor[slot](name);
    if (slot !== 'global') setImageOriginalFor[slot](original);
  };
  const clearReferenceHtmlFor = (slot: ReferenceSlot) => {
    setHtmlFor[slot](null);
    setHtmlNameFor[slot]('');
  };
  const clearReferenceImageFor = (slot: ReferenceSlot) => {
    setImageFor[slot](null);
    setImageNameFor[slot]('');
    if (slot !== 'global') setImageOriginalFor[slot](null);
  };
  // 当前各 slot 的取值（用于渲染缩略图/文件名）
  const htmlValueFor: Record<ReferenceSlot, string | null> = {
    global: referenceHtml,
    cover: referenceHtmlCover,
    content: referenceHtmlContent,
    summary: referenceHtmlSummary,
  };
  const htmlNameFor: Record<ReferenceSlot, string> = {
    global: referenceHtmlName,
    cover: referenceHtmlCoverName,
    content: referenceHtmlContentName,
    summary: referenceHtmlSummaryName,
  };
  const imageValueFor: Record<ReferenceSlot, string | null> = {
    global: referenceImage,
    cover: referenceImageCover,
    content: referenceImageContent,
    summary: referenceImageSummary,
  };
  const imageNameFor: Record<ReferenceSlot, string> = {
    global: referenceImageName,
    cover: referenceImageCoverName,
    content: referenceImageContentName,
    summary: referenceImageSummaryName,
  };
  const pendingRef = useRef<{
    slot: ReferenceSlot;
    kind: ReferenceKind;
  } | null>(null);
  const triggerReferenceFile = (slot: ReferenceSlot, kind: ReferenceKind) => {
    pendingRef.current = { slot, kind };
    if (kind === 'html') htmlInputRef.current?.click();
    else imageInputRef.current?.click();
  };
  const handleReferenceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const { slot, kind } = pending;
    const file = e.target.files?.[0];
    if (!file) return;
    if (kind === 'html') {
      readFileAsText(file)
        .then((content) => {
          applyReferenceHtml(slot, content, file.name);
          showToast(t('已导入参考 HTML：{name}', { name: file.name }), 'success');
        })
        .catch(() => showToast(t('HTML 读取失败'), 'error'));
    } else {
      readFileAsDataUrl(file)
        .then(async (dataUrl) => {
          const compressed = await compressImageDataUrl(dataUrl);
          applyReferenceImage(slot, compressed, dataUrl, file.name);
          showToast(t('已导入参考图片：{name}', { name: file.name }), 'success');
        })
        .catch(() => showToast(t('图片读取失败'), 'error'));
    }
    e.target.value = '';
  };
  const renderReferenceRow = (slot: ReferenceSlot, kind: ReferenceKind) => {
    const isHtml = kind === 'html';
    const value = isHtml ? htmlValueFor[slot] : imageValueFor[slot];
    const name = isHtml ? htmlNameFor[slot] : imageNameFor[slot];
    const clear = isHtml ? () => clearReferenceHtmlFor(slot) : () => clearReferenceImageFor(slot);
    return (
      <button
        key={`${slot}-${kind}`}
        onClick={() => triggerReferenceFile(slot, kind)}
        className={`p-3 rounded-xl border-2 text-left transition-all flex items-center gap-2 ${
          value
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
            : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
        }`}
      >
        {isHtml ? (
          <FileCode
            className={`w-5 h-5 flex-shrink-0 ${value ? 'text-blue-500' : 'text-slate-400'}`}
          />
        ) : value ? (
          <img src={value} alt="" className="w-10 h-10 object-cover rounded-lg flex-shrink-0" />
        ) : (
          <FileImage className="w-5 h-5 text-slate-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={`font-medium text-sm truncate ${value ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}
          >
            {value ? name : isHtml ? t('参考 HTML') : t('参考图片')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {value ? t('已导入') : isHtml ? t('模仿风格') : t('生成配图参考')}
          </p>
        </div>
        {value && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full flex-shrink-0"
          >
            <X className="w-3 h-3 text-blue-500" />
          </button>
        )}
      </button>
    );
  };
  const renderCategoryCard = (slot: ReferenceSlot, title: string, subtitle: string) => (
    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/30">
      <p className="font-medium text-sm text-slate-800 dark:text-slate-100 mb-1">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{subtitle}</p>
      <div className="grid grid-cols-2 gap-3">
        {renderReferenceRow(slot, 'html')}
        {renderReferenceRow(slot, 'image')}
      </div>
    </div>
  );
  useEffect(() => {
    if (loading) {
      startTimeRef.current = Date.now();
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(Date.now() - startTimeRef.current);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading]);
  /**
   * 素材长度上限：随「幻灯片页数」联动（每页约 800 字，3000~20000 封顶）。
   * 草稿若带了自己的上限（Hermes 侧算得），取二者较小值——两端策略取严。
   */
  const effectiveReferenceLimit = (() => {
    const derived = referenceTextLimit(
      slideCountMode === 'exact' ? exactSlideCount : DEFAULT_SLIDE_COUNT,
    );
    return draftReferenceLimit ? Math.min(draftReferenceLimit, derived) : derived;
  })();
  /** 已超上限需要二次裁剪时给出提示（用户改小页数导致超限）。 */
  const referenceOverLimit = referenceText.length > effectiveReferenceLimit;
  const buildGenerateParams = () => {
    const modelConfigs = settings.getModelConfigsForStages();
    const imageGenConfig = settings.getImageGenerationConfig();
    const imageConfig = settings.imageGeneration.enabled
      ? {
          enabled: true,
          useDefaultProvider: imageGenConfig.useDefaultApiKey,
          provider: imageGenConfig.provider,
          model: imageGenConfig.model,
          size: imageGenConfig.size,
          gatewayVendor: imageGenConfig.gatewayVendor,
          allModels: imageGenConfig.allModels,
          routing: imageGenConfig.routing,
          modelConfig: {
            provider: imageGenConfig.provider,
            apiKey: imageGenConfig.useDefaultApiKey ? '' : imageGenConfig.apiKey,
            baseUrl: imageGenConfig.baseUrl,
            model: imageGenConfig.model,
          },
        }
      : undefined;
    return {
      topic,
      modelConfigs,
      imageConfig,
      style,
      audience,
      density,
      imagePreference,
      colorTheme: colorTheme || undefined,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      slideCount: slideCountMode === 'exact' ? exactSlideCount : undefined,
      slideCountMin: slideCountMode === 'range' ? minSlideCount : undefined,
      slideCountMax: slideCountMode === 'range' ? maxSlideCount : undefined,
      referenceHtml: referenceHtml || undefined,
      referenceImage: referenceImage || undefined,
      // 三类分类参考（FR-13.1 / C-15）
      referenceHtmlCover: referenceHtmlCover || undefined,
      // RAG / 对话上下文的「权威素材」：planning 阶段注入大纲 prompt（读 ref，见 updateReferenceText 注释）
      // 提交前再按当前页数上限裁一次：用户可能在填完素材后又改小了页数。
      referenceText:
        (referenceTextRef.current || '').slice(0, effectiveReferenceLimit).trim() || undefined,
      referenceImageCover: referenceImageCover || undefined,
      referenceHtmlContent: referenceHtmlContent || undefined,
      referenceImageContent: referenceImageContent || undefined,
      referenceHtmlSummary: referenceHtmlSummary || undefined,
      referenceImageSummary: referenceImageSummary || undefined,
      // 原图副本（Q7）：与压缩图并行发送，供后续母版 LOGO 提取（FR-16）
      referenceImageCoverOriginal: referenceImageCoverOriginal || undefined,
      referenceImageContentOriginal: referenceImageContentOriginal || undefined,
      referenceImageSummaryOriginal: referenceImageSummaryOriginal || undefined,
      // 跨步骤参考属性缓存版本号：plan 步骤返回，后续步骤原样回传以复用
      refAttrsVersion: refAttrsVersionRef.current || undefined,
      presentationId: presentation?.id,
      traceSessionId: traceSessionIdRef.current || undefined,
      slideWidth: settings.editorSettings.defaultSlideWidth,
      slideHeight: settings.editorSettings.defaultSlideHeight,
      logSettings: settings.logSettings,
      enableAudit: autoAuditEnabled,
      // 生成语言：'follow' 表示跟随当前界面语言
      language:
        genLanguage === 'follow'
          ? useSettingsStore.getState().interfaceSettings.language
          : genLanguage,
      critique: {
        enabled: inlineSelfCheckEnabled,
        llmCritique:
          inlineSelfCheckEnabled && (settings.inlineSelfCheckSettings?.llmCritique ?? true),
        vlmPlaceholder:
          inlineSelfCheckEnabled && (settings.inlineSelfCheckSettings?.vlmPlaceholder ?? true),
        threshold: settings.inlineSelfCheckSettings?.threshold ?? 7,
        maxRetries: settings.inlineSelfCheckSettings?.maxRetries ?? 1,
      },
    };
  };
  const ensureTraceSessionId = () => {
    if (!traceSessionIdRef.current) {
      traceSessionIdRef.current = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    return traceSessionIdRef.current;
  };
  const clearTraceSessionId = () => {
    traceSessionIdRef.current = null;
  };
  /**
   * 消费 Hermes 草稿预填（深链进入时）：只填表单，**停在 config 等用户确认**，
   * 不触发任何生成动作。模式预选「全自动」，三选一卡片仍可改。
   */
  useEffect(() => {
    if (!open) return;
    const prefill = consumeAIPrefill();
    if (!prefill) return;
    if (prefill.topic) setTopic(prefill.topic);
    // 后端 style 枚举含 tech，前端风格卡片无此项 → 就近映射到「创意」
    if (prefill.style) {
      const mapped = prefill.style === 'tech' ? 'creative' : prefill.style;
      if (
        mapped === 'business' ||
        mapped === 'creative' ||
        mapped === 'simple' ||
        mapped === 'academic'
      ) {
        setStyle(mapped);
      }
    }
    if (prefill.audience) setAudience(prefill.audience);
    if (typeof prefill.slideCount === 'number' && prefill.slideCount > 0) {
      setSlideCountMode('exact');
      setExactSlideCount(Math.min(20, Math.max(1, Math.trunc(prefill.slideCount))));
    }
    if (prefill.colorTheme && (COLOR_THEME_IDS as readonly string[]).includes(prefill.colorTheme)) {
      setColorTheme(prefill.colorTheme as ColorTheme);
    }
    if (
      prefill.fontFamily === 'sans' ||
      prefill.fontFamily === 'serif' ||
      prefill.fontFamily === 'mono'
    ) {
      setFontFamily(prefill.fontFamily);
    }
    if (prefill.iconStyle && (ICON_STYLE_IDS as readonly string[]).includes(prefill.iconStyle)) {
      setIconStyle(prefill.iconStyle as IconStyle);
    }
    // 预选全自动（用户仍可在配置页改）
    setMode(prefill.mode === 'guided' ? 'guided' : 'auto');
    const text = prefill.referenceText ?? '';
    updateReferenceText(text);
    setReferenceInitial(text);
    setReferenceSource(prefill.referenceSource);
    setDraftReferenceLimit(prefill.referenceLimit);
    setReferenceTruncated(!!prefill.referenceTruncated);
    setReferenceOriginalChars(prefill.referenceOriginalChars ?? 0);
    setShowReference(!!text);
  }, [open, consumeAIPrefill]);
  const resetState = () => {
    setStage('config');
    setMode('guided');
    setPlan(null);
    refAttrsVersionRef.current = undefined;
    setRefAttrsVersion(undefined);
    updateReferenceText('');
    setReferenceInitial('');
    setReferenceSource(undefined);
    setDraftReferenceLimit(undefined);
    setReferenceTruncated(false);
    setReferenceOriginalChars(0);
    setShowReference(false);
    setEditableSlides([]);
    setEditableTitle('');
    setTopic('');
    setPlanLoading(false);
    setDesignProposals([]);
    setSelectedDesign(null);
    setRenderedSlides([]);
    setDesignLoading(false);
    setLayoutLoading(false);
    setApprovedSlides([]);
    setProgress({ current: 0, total: 0, message: '' });
    clearTraceSessionId();
  };
  const handleClose = () => {
    if (loading || planLoading || designLoading || layoutLoading) return;
    resetState();
    onClose();
  };
  const finalizePresentationResult = async (generatedPres: any, startTimeBeijing: string) => {
    const endTimeBeijing = formatBeijingTime();
    const totalDuration = Date.now() - startTimeRef.current;
    if (presentation) {
      const validTransitions = ['none', 'fade', 'slide', 'zoom', 'flip'];
      const transition = validTransitions.includes((generatedPres as any).transition || '')
        ? ((generatedPres as any).transition as 'none' | 'fade' | 'slide' | 'zoom' | 'flip')
        : 'none';
      const normalizedSlides = generatedPres.slides.map((slide: any) =>
        LayoutEngine.normalizeAISlide(slide),
      );
      setPresentation(
        {
          ...presentation,
          title: generatedPres.title,
          slides: normalizedSlides,
          selectedSlideId: normalizedSlides[0]?.id,
          transition,
          width: generatedPres.width || settings.editorSettings.defaultSlideWidth,
          height: generatedPres.height || settings.editorSettings.defaultSlideHeight,
          updatedAt: Date.now(),
        },
        false,
        true,
      );
      const ok = await savePresentation();
      if (!ok) {
        console.warn(
          'Auto-save after AI generation failed, but content is available in editor - user can manually save later',
        );
      }
      const styleNames: Record<string, string> = {
        business: '商务风',
        creative: '创意风',
        simple: '简约风',
        academic: '学术风',
      };
      const densityNames: Record<Density, string> = {
        compact: '紧凑',
        normal: '适中',
        spacious: '宽松',
      };
      const imagePrefNames: Record<ImagePref, string> = {
        all: '每页配图',
        'content-only': '仅内容页配图',
        minimal: '尽量少图',
        none: '无图',
      };
      const refDesc = referenceHtml ? `，参考 HTML：${referenceHtmlName}` : '';
      const refImgDesc = referenceImage ? `，参考图片：${referenceImageName}` : '';
      const colorDesc = colorTheme
        ? `，配色：${colorThemeOptions.find((c) => c.id === colorTheme)?.name}`
        : '';
      const audienceDesc = audience
        ? `，受众：${audienceOptions.find((a) => a.id === audience)?.name || audience}`
        : '';
      const fontFamilyDesc = fontFamily
        ? `，字体：${fontFamilyOptions.find((f) => f.id === fontFamily)?.name}`
        : '';
      const slideCountDesc =
        slideCountMode === 'exact'
          ? `，${exactSlideCount} 页`
          : slideCountMode === 'range'
            ? `，${minSlideCount}~${maxSlideCount} 页`
            : '';
      addChatMessage({
        id: Date.now().toString(),
        role: 'user',
        content: `生成一个关于"${topic}"的演示文稿，${styleNames[style] || style}风格${slideCountDesc}${audienceDesc}${fontFamilyDesc}，${densityNames[density]}排版，${imagePrefNames[imagePreference]}${colorDesc}${refDesc}${refImgDesc}`,
        scope: 'global',
        timestamp: startTimeBeijing,
      });
      const durationSeconds = (totalDuration / 1000).toFixed(1);
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `演示文稿已生成！共 ${normalizedSlides.length} 页，主题是"${generatedPres.title}"。\n\n⏱️ 开始时间：${startTimeBeijing}\n⏱️ 完成时间：${endTimeBeijing}\n⏱️ 耗时：${durationSeconds}秒\n\n你可以继续让我调整内容或样式。`,
        scope: 'global',
        timestamp: endTimeBeijing,
      });
      showToast(t('演示文稿生成成功！'), 'success');
    }
    setStage('done');
    setTimeout(() => {
      resetState();
      onClose();
    }, 1500);
  };
  const handleGenerationError = (error: unknown, startTimeBeijing: string) => {
    console.error('Generation failed:', error);
    const errorMessage = error instanceof Error ? error.message : t('未知错误');
    const errorTime = formatBeijingTime();
    addChatMessage({
      id: Date.now().toString(),
      role: 'user',
      content: `生成一个关于"${topic}"的演示文稿`,
      scope: 'global',
      timestamp: startTimeBeijing,
    });
    addChatMessage({
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: `抱歉，生成失败了：${errorMessage}。请检查 API 配置或重试。\n\n失败时间：${errorTime}`,
      scope: 'global',
      timestamp: errorTime,
    });
    showToast(t('生成失败，请检查 API 配置'), 'error');
  };
  const runFullAutoPipeline = async (finalPlan: PresentationPlan) => {
    const startTimeBeijing = formatBeijingTime();
    setStage('generating');
    setLoading(true);
    setProgress({ current: 0, total: 0, message: t('正在规划大纲...') });
    try {
      ensureTraceSessionId();
      const baseParams = buildGenerateParams();
      setProgress({ current: 0, total: 0, message: t('正在匹配设计方案...') });
      const proposals = await aiApi.generateDesignProposals({
        ...baseParams,
        plan: finalPlan,
        proposalCount: 1,
      });
      if (proposals.length === 0) {
        showToast(t('设计方案生成失败，请重试'), 'error');
        return;
      }
      const [design] = proposals;
      setSelectedDesign(design);
      setProgress({ current: 0, total: 0, message: t('正在排版页面...') });
      const firstSlide = design.slides?.[0];
      let slides: RenderedSlide[];
      if (finalPlan.slides.length <= 1) {
        slides = firstSlide ? [firstSlide] : [];
      } else {
        const restSlides = await aiApi.renderSlides({
          ...baseParams,
          plan: finalPlan,
          design,
          startIndex: 1,
        });
        slides = firstSlide ? [firstSlide, ...restSlides] : restSlides;
      }
      setRenderedSlides(slides);
      setProgress({ current: 0, total: 0, message: t('正在生成配图...') });
      const assembledSlides = await aiApi.assembleImages({
        ...baseParams,
        plan: finalPlan,
        design,
        slides,
      });
      setProgress({ current: 0, total: 0, message: t('正在润色终稿...') });
      const generatedPres = await aiApi.finalizePresentation({
        ...baseParams,
        plan: finalPlan,
        design,
        slides: assembledSlides,
      });
      await finalizePresentationResult(generatedPres, startTimeBeijing);
    } catch (error) {
      handleGenerationError(error, startTimeBeijing);
    } finally {
      setLoading(false);
    }
  };
  const runGuidedFinalize = async () => {
    if (!plan || !selectedDesign) return;
    const finalPlan: PresentationPlan = {
      ...plan,
      title: editableTitle || plan.title,
      slides: editableSlides,
    };
    const startTimeBeijing = formatBeijingTime();
    setStage('generating');
    setLoading(true);
    setProgress({ current: 0, total: 0, message: t('正在生成配图...') });
    try {
      const baseParams = buildGenerateParams();
      const assembledSlides = await aiApi.assembleImages({
        ...baseParams,
        plan: finalPlan,
        design: selectedDesign,
        slides: renderedSlides,
      });
      setProgress({ current: 0, total: 0, message: t('正在润色终稿...') });
      const generatedPres = await aiApi.finalizePresentation({
        ...baseParams,
        plan: finalPlan,
        design: selectedDesign,
        slides: assembledSlides,
      });
      await finalizePresentationResult(generatedPres, startTimeBeijing);
    } catch (error) {
      handleGenerationError(error, startTimeBeijing);
    } finally {
      setLoading(false);
    }
  };
  const handleGeneratePlan = async () => {
    if (planLoading || designLoading || layoutLoading || loading) return;
    if (!topic.trim()) {
      showToast(t('请输入演示文稿主题'), 'warning');
      return;
    }
    if (!settings.hasApiKey()) {
      const now = formatBeijingTime();
      addChatMessage({
        id: Date.now().toString(),
        role: 'user',
        content: `生成一个关于"${topic}"的演示文稿`,
        scope: 'global',
        timestamp: now,
      });
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t('抱歉，生成失败了：请先在设置中配置 API Key。'),
        scope: 'global',
        timestamp: now,
      });
      showToast(t('请先在设置中配置 API Key'), 'error');
      onClose();
      return;
    }
    setPlanLoading(true);
    try {
      const params = buildGenerateParams();
      const generatedPlan = await aiApi.planPresentation(params);
      setPlan(generatedPlan);
      refAttrsVersionRef.current = generatedPlan.refAttrsVersion;
      setRefAttrsVersion(generatedPlan.refAttrsVersion);
      setEditableSlides(generatedPlan.slides.map((s) => ({ ...s, keyPoints: [...s.keyPoints] })));
      setEditableTitle(generatedPlan.title);
      if (mode === 'auto') {
        setPlanLoading(false);
        const finalPlan: PresentationPlan = {
          ...generatedPlan,
          slides: generatedPlan.slides.map((s) => ({ ...s, keyPoints: [...s.keyPoints] })),
        };
        await runFullAutoPipeline(finalPlan);
      } else {
        setStage('outline');
      }
    } catch (error) {
      console.error('Plan generation failed:', error);
      const errorMessage = error instanceof Error ? error.message : t('未知错误');
      const errorTime = formatBeijingTime();
      const now = formatBeijingTime();
      addChatMessage({
        id: Date.now().toString(),
        role: 'user',
        content: `生成一个关于"${topic}"的演示文稿`,
        scope: 'global',
        timestamp: now,
      });
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `抱歉，大纲生成失败了：${errorMessage}。请检查 API 配置或重试。\n\n失败时间：${errorTime}`,
        scope: 'global',
        timestamp: errorTime,
      });
      showToast(t('大纲生成失败，请检查 API 配置'), 'error');
    } finally {
      setPlanLoading(false);
    }
  };
  const handleConfirmOutline = async () => {
    if (!plan || designLoading || planLoading) return;
    const finalPlan: PresentationPlan = {
      ...plan,
      title: editableTitle || plan.title,
      slides: editableSlides,
    };
    setDesignLoading(true);
    try {
      ensureTraceSessionId();
      const proposals = await aiApi.generateDesignProposals({
        ...buildGenerateParams(),
        plan: finalPlan,
      });
      setDesignProposals(proposals);
      setSelectedDesign(null);
      setStage('design');
    } catch (error) {
      console.error('Design proposal generation failed:', error);
      showToast(t('设计方案生成失败，请重试'), 'error');
    } finally {
      setDesignLoading(false);
    }
  };
  const handleSelectDesignAndRender = async () => {
    if (!plan || !selectedDesign || layoutLoading || designLoading) return;
    const finalPlan: PresentationPlan = {
      ...plan,
      title: editableTitle || plan.title,
      slides: editableSlides,
    };
    setLayoutLoading(true);
    try {
      const firstSlide = selectedDesign.slides?.[0];
      let slides: RenderedSlide[];
      if (finalPlan.slides.length <= 1) {
        slides = firstSlide ? [firstSlide] : [];
      } else {
        const restSlides = await aiApi.renderSlides({
          ...buildGenerateParams(),
          plan: finalPlan,
          design: selectedDesign,
          startIndex: 1,
        });
        slides = firstSlide ? [firstSlide, ...restSlides] : restSlides;
      }
      setRenderedSlides(slides);
      setApprovedSlides(slides.map(() => true));
      setStage('layout-preview');
    } catch (error) {
      console.error('Slide rendering failed:', error);
      showToast(t('页面排版生成失败，请重试'), 'error');
    } finally {
      setLayoutLoading(false);
    }
  };
  const updateSlideTitle = (index: number, title: string) => {
    setEditableSlides((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], title };
      return next;
    });
  };
  const updateKeyPoint = (slideIndex: number, pointIndex: number, value: string) => {
    setEditableSlides((prev) => {
      const next = [...prev];
      const slide = { ...next[slideIndex] };
      slide.keyPoints = [...slide.keyPoints];
      slide.keyPoints[pointIndex] = value;
      next[slideIndex] = slide;
      return next;
    });
  };
  const addKeyPoint = (slideIndex: number) => {
    setEditableSlides((prev) => {
      const next = [...prev];
      const slide = { ...next[slideIndex] };
      slide.keyPoints = [...slide.keyPoints, ''];
      next[slideIndex] = slide;
      return next;
    });
  };
  const removeKeyPoint = (slideIndex: number, pointIndex: number) => {
    setEditableSlides((prev) => {
      const next = [...prev];
      const slide = { ...next[slideIndex] };
      slide.keyPoints = slide.keyPoints.filter((_, i) => i !== pointIndex);
      next[slideIndex] = slide;
      return next;
    });
  };
  const toggleApprovedSlide = (index: number) => {
    setApprovedSlides((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };
  const handleRegenerateSlide = async (index: number) => {
    if (!plan || !selectedDesign || regeneratingSlides.has(index)) return;
    const finalPlan: PresentationPlan = {
      ...plan,
      title: editableTitle || plan.title,
      slides: editableSlides,
    };
    setRegeneratingSlides((prev) => new Set(prev).add(index));
    try {
      const newSlide = await aiApi.regenerateSlide({
        ...buildGenerateParams(),
        plan: finalPlan,
        design: selectedDesign,
        slideIndex: index,
      });
      setRenderedSlides((prev) => {
        const next = [...prev];
        next[index] = newSlide;
        return next;
      });
      setApprovedSlides((prev) => {
        const next = [...prev];
        next[index] = true;
        return next;
      });
      showToast(t('第 {n} 页已重新生成', { n: index + 1 }), 'success');
    } catch (error) {
      console.error('Failed to regenerate slide:', error);
      showToast(t('第 {n} 页重新生成失败', { n: index + 1 }), 'error');
    } finally {
      setRegeneratingSlides((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };
  const styles = [
    { id: 'business', name: '商务风', desc: t('专业正式') },
    { id: 'creative', name: '创意风', desc: t('活泼有趣') },
    { id: 'simple', name: '简约风', desc: t('简洁明了') },
    { id: 'academic', name: '学术风', desc: t('严谨专业') },
  ];
  if (!open) return null;
  const accentColor = plan?.primaryColor || selectedDesign?.primaryColor || '#2563eb';
  const isWideLayout =
    stage === 'outline' ||
    stage === 'design' ||
    stage === 'layout-preview' ||
    stage === 'generating' ||
    stage === 'done';
  const getHeaderInfo = () => {
    if (stage === 'outline')
      return {
        icon: <ListChecks className="w-5 h-5 text-white" />,
        title: t('确认大纲'),
        subtitle: '编辑标题和要点后继续',
      };
    if (stage === 'design')
      return {
        icon: <Sparkles className="w-5 h-5 text-white" />,
        title: t('选择视觉风格'),
        subtitle: 'AI 推荐的设计方案',
      };
    if (stage === 'layout-preview')
      return {
        icon: <ImageIcon className="w-5 h-5 text-white" />,
        title: t('预览页面排版'),
        subtitle: '检查每页排版结构',
      };
    if (stage === 'generating')
      return {
        icon: <Sparkles className="w-5 h-5 text-white" />,
        title: t('正在生成幻灯片'),
        subtitle: '请稍候...',
      };
    if (stage === 'done')
      return {
        icon: <Check className="w-5 h-5 text-white" />,
        title: t('生成完成'),
        subtitle: '即将打开编辑器...',
      };
    return {
      icon: <Sparkles className="w-5 h-5 text-white" />,
      title: t('AI 生成演示文稿'),
      subtitle: t('用一句话生成完整演示'),
    };
  };
  const headerInfo = getHeaderInfo();
  const primaryButtonText = mode === 'auto' ? t('🚀 一键生成') : t('生成大纲');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className={`bg-white dark:bg-slate-800 rounded-2xl w-full ${isWideLayout ? 'max-w-4xl' : 'max-w-lg'} shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto`}
      >
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              {headerInfo.icon}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{headerInfo.title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{headerInfo.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {stage === 'config' && !planLoading && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('生成模式')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {modeOptions.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`relative p-3 rounded-xl border-2 text-left transition-all ${
                        mode === m.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      {m.badge && (
                        <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-gradient-to-r from-orange-400 to-pink-500 text-white text-[10px] font-bold rounded-full">
                          {m.badge}
                        </span>
                      )}
                      <div
                        className={`mb-1.5 ${mode === m.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                      >
                        {m.icon}
                      </div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t(m.title)}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                        {t(m.desc)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('演示主题')}
                </label>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t(
                    '例如：2024年度工作总结与2025规划，包含业绩回顾、问题分析、明年计划，10页左右...',
                  )}
                  className="w-full h-24 px-4 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>

              {/* 参考素材（来自企业知识库 / RAG）：planning 阶段作为「权威素材」注入大纲 prompt */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowReference(!showReference)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <Database
                    className={`w-4 h-4 ${referenceText ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('参考素材（来自企业知识库 / RAG）')}
                  </span>
                  {referenceSource && (
                    <span className="px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                      {referenceSource}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {referenceText ? (
                      <span
                        className={`text-[11px] ${referenceOverLimit ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
                      >
                        {referenceText.length.toLocaleString()} /{' '}
                        {effectiveReferenceLimit.toLocaleString()}
                        {t('字')}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {t('未注入')}
                      </span>
                    )}
                    {showReference ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </span>
                </button>

                {showReference && (
                  <div className="p-3 space-y-2 border-t border-slate-200 dark:border-slate-600">
                    {(referenceTruncated || referenceOverLimit) && (
                      <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-[11px] text-orange-600 dark:text-orange-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                        <span>
                          {referenceTruncated
                            ? t('已按生成要求裁剪：原 {from} 字 → {to} 字（每页约 800 字）', {
                                from: referenceOriginalChars.toLocaleString(),
                                to: effectiveReferenceLimit.toLocaleString(),
                              })
                            : t('当前页数下素材上限为 {n} 字，超出部分将不会被用于生成', {
                                n: effectiveReferenceLimit.toLocaleString(),
                              })}
                        </span>
                      </div>
                    )}
                    <textarea
                      value={referenceText}
                      onChange={(e) => updateReferenceText(e.target.value)}
                      placeholder={t(
                        '粘贴或编辑权威素材：企业知识库检索结果、文档整理稿、对话上下文摘要……这些内容会在规划大纲阶段作为「权威素材」参与生成。',
                      )}
                      className="w-full h-40 px-3 py-2.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs font-mono leading-relaxed"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`text-[11px] ${
                          referenceOverLimit
                            ? 'text-red-600 dark:text-red-400'
                            : referenceText.length >= effectiveReferenceLimit * 0.9
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {referenceText.length.toLocaleString()} /{' '}
                        {effectiveReferenceLimit.toLocaleString()}
                        {t('字')}
                      </span>
                      <div className="flex items-center gap-3">
                        {referenceInitial && referenceText !== referenceInitial && (
                          <button
                            type="button"
                            onClick={() => updateReferenceText(referenceInitial)}
                            className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {t('恢复初始素材')}
                          </button>
                        )}
                        {referenceText && (
                          <button
                            type="button"
                            onClick={() => updateReferenceText('')}
                            className="text-[11px] text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                          >
                            {t('清空素材')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('风格选择')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {styles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id as any)}
                      className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                        style === s.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      <p className="font-medium text-sm text-slate-900 dark:text-white">{s.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-full"
              >
                <Settings2 className="w-4 h-4" />
                <span>{t('高级排版选项')}</span>
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4 ml-auto" />
                ) : (
                  <ChevronDown className="w-4 h-4 ml-auto" />
                )}
              </button>

              {showAdvanced && (
                <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('幻灯片页数')}
                    </label>
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden mb-3 w-full">
                      {(
                        [
                          { id: 'auto', name: '自动' },
                          { id: 'exact', name: '固定页数' },
                          { id: 'range', name: '页数区间' },
                        ] as {
                          id: SlideCountMode;
                          name: string;
                        }[]
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSlideCountMode(tab.id)}
                          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                            slideCountMode === tab.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                          }`}
                        >
                          {tab.name}
                        </button>
                      ))}
                    </div>
                    <div>
                      {slideCountMode === 'auto' && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {t(
                            'AI 根据主题自行决定，默认 8 页。可在主题中直接指定（如「5-10页」「做6页」等）。',
                          )}
                        </p>
                      )}
                      {slideCountMode === 'exact' && (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExactSlideCount((v) => Math.max(1, v - 1))}
                              className="px-3 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={exactSlideCount}
                              onChange={(e) => {
                                const v = parseInt(e.target.value || '0', 10);
                                if (!Number.isNaN(v))
                                  setExactSlideCount(Math.max(1, Math.min(20, v)));
                              }}
                              className="w-16 text-center border-x border-slate-200 dark:border-slate-600 py-2 text-sm font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setExactSlideCount((v) => Math.min(20, v + 1))}
                              className="px-3 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                            >
                              +
                            </button>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            {t('固定')}
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {exactSlideCount}
                            </span>
                            {t('页（范围 1~20）')}
                          </p>
                        </div>
                      )}
                      {slideCountMode === 'range' && (
                        <div className="flex items-center flex-wrap gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {t('最少')}
                            </span>
                            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.max(1, minSlideCount - 1);
                                  setMinSlideCount(next);
                                  if (next > maxSlideCount) setMaxSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={minSlideCount}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value || '0', 10);
                                  if (Number.isNaN(v)) return;
                                  const next = Math.max(1, Math.min(20, v));
                                  setMinSlideCount(next);
                                  if (next > maxSlideCount) setMaxSlideCount(next);
                                }}
                                className="w-14 text-center border-x border-slate-200 dark:border-slate-600 py-2 text-sm font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.min(20, minSlideCount + 1);
                                  setMinSlideCount(next);
                                  if (next > maxSlideCount) setMaxSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <span className="text-slate-400 dark:text-slate-500 font-medium">~</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {t('最多')}
                            </span>
                            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.max(1, maxSlideCount - 1);
                                  setMaxSlideCount(next);
                                  if (next < minSlideCount) setMinSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={maxSlideCount}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value || '0', 10);
                                  if (Number.isNaN(v)) return;
                                  const next = Math.max(1, Math.min(20, v));
                                  setMaxSlideCount(next);
                                  if (next < minSlideCount) setMinSlideCount(next);
                                }}
                                className="w-14 text-center border-x border-slate-200 dark:border-slate-600 py-2 text-sm font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.min(20, maxSlideCount + 1);
                                  setMaxSlideCount(next);
                                  if (next < minSlideCount) setMinSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 ml-auto w-full sm:ml-0 sm:w-auto mt-1 sm:mt-0">
                            {t('页数范围')}
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {minSlideCount} ~ {maxSlideCount}
                            </span>
                            {t('，AI 按主题复杂度自决定（范围 1~20）')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('目标受众')}
                    </label>
                    <select
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700"
                    >
                      {audienceOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {t(opt.name)} · {t(opt.desc)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('影响内容深度、用词专业度和案例风格')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('生成语言')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'follow', name: '跟随界面' },
                          { id: 'zh-CN', name: '中文' },
                          { id: 'en', name: 'English' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setGenLanguage(opt.id)}
                          className={`p-2 rounded-xl border-2 text-center transition-all ${
                            genLanguage === opt.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(opt.name)}
                          </p>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('仅影响本次 AI 生成的正文语言，不改变界面语言')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('字体风格')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {fontFamilyOptions.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setFontFamily(f.id)}
                          className={`p-2 rounded-xl border-2 text-left transition-all ${
                            fontFamily === f.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                          }`}
                          // NOTE: FONT_STACK_MONO —— 若修改请同步：
                          //   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack('mono')
                          //   - web: packages/web/src/components/AIGenerateModal.tsx L### mono 预览 style
                          //   目的：CJK 字体在 Windows 回退时命中微软雅黑(PingFangSC)而不是 SimSun(衬线宋)。
                          style={{
                            fontFamily:
                              f.id === 'serif'
                                ? "Georgia,'Noto Serif SC',serif"
                                : f.id === 'mono'
                                  ? t(
                                      "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace",
                                    )
                                  : "system-ui,'PingFang SC','Microsoft YaHei',sans-serif",
                          }}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(f.name)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t(f.desc)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('自动添加背景图')}
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t('为封面、目录、内容、总结页生成匹配主题的背景图')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBackgroundEnabled(!backgroundEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${backgroundEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${backgroundEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('AI 自动评审')}
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t(
                            '生成完成后调用多引擎自动审核幻灯片，发现问题自动修复或重新生成（可在设置→AI模型→AI审核设置中配置严格度与阈值）',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoAuditEnabled(!autoAuditEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoAuditEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoAuditEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('内联自检')}
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t(
                            '每页生成后立即执行 LLM 文本自检 + VLM 占位视觉评审，未通过当场重做（可在设置→AI模型→AI内联自检设置中配置子项）',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInlineSelfCheckEnabled(!inlineSelfCheckEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${inlineSelfCheckEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${inlineSelfCheckEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('配色主题')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setColorTheme('')}
                        className={`px-3 py-1.5 rounded-lg text-sm border-2 transition-all ${
                          colorTheme === ''
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                        }`}
                      >
                        {t('自动')}
                      </button>
                      {colorThemeOptions.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setColorTheme(c.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border-2 transition-all ${
                            colorTheme === c.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: c.color }}
                          ></span>
                          <span className="text-slate-700 dark:text-slate-300">{t(c.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('内容密度')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'compact', name: '紧凑', desc: t('信息量大') },
                          { id: 'normal', name: '适中', desc: t('平衡') },
                          { id: 'spacious', name: '宽松', desc: t('留白多') },
                        ] as const
                      ).map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setDensity(d.id)}
                          className={`p-2 rounded-lg border-2 text-center transition-all ${
                            density === d.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {d.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{d.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('配图偏好')}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'content-only', name: '仅内容页配图', desc: t('推荐') },
                          { id: 'minimal', name: '尽量少图', desc: t('文字为主') },
                          { id: 'none', name: '无图', desc: t('纯文字') },
                          { id: 'all', name: '每页都配图', desc: t('含封面') },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setImagePreference(p.id)}
                          className={`p-2 rounded-lg border-2 text-left transition-all ${
                            imagePreference === p.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {p.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{p.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('列表图标风格')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {iconStyleOptions.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setIconStyle(opt.id)}
                          className={`p-2 rounded-lg border-2 text-left transition-all ${
                            iconStyle === opt.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(opt.name)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t(opt.desc)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('参考文件（可选）')}
                </label>

                {/* 全局共享参考（向后兼容 NFR-3）：未单独上传分类参考时的兜底来源 */}
                <div className="mb-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {t('全局共享参考：未单独上传分类参考时，作为所有页面的兜底来源')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {renderReferenceRow('global', 'html')}
                    {renderReferenceRow('global', 'image')}
                  </div>
                </div>

                {/* 三类分类参考（FR-13.1 / C-15）：封面 / 内容 / 总结 各自独立通道 */}
                <div className="space-y-3">
                  {renderCategoryCard(
                    'cover',
                    t('封面参考（仅用于首页封面页）'),
                    t('未上传则封面页不应用任何参考属性'),
                  )}
                  {renderCategoryCard(
                    'content',
                    t('内容参考（用于目录和正文内容页）'),
                    t('未上传则目录/内容页不应用任何参考属性（目录页与正文页共用同一份内容参考）'),
                  )}
                  {renderCategoryCard(
                    'summary',
                    t('总结参考（仅用于结尾总结页）'),
                    t('未上传则总结页不应用任何参考属性'),
                  )}
                </div>

                {/* 隐藏文件输入：由 triggerReferenceFile 触发，按 pendingRef 区分 slot/kind */}
                <input
                  ref={htmlInputRef}
                  type="file"
                  accept=".html,.htm"
                  onChange={handleReferenceFileChange}
                  className="hidden"
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReferenceFileChange}
                  className="hidden"
                />
              </div>
            </>
          )}

          {planLoading && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {t('正在生成大纲...')}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {t('AI 正在规划演示文稿结构，请稍候')}
              </p>
            </div>
          )}

          {designLoading && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {t('正在生成设计方案...')}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {t('AI 正在为你的内容匹配视觉风格，请稍候')}
              </p>
            </div>
          )}

          {layoutLoading && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {t('正在排版页面...')}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {t('AI 正在根据设计方案逐页生成排版，请稍候')}
              </p>
            </div>
          )}

          {stage === 'outline' && plan && !designLoading && (
            <div className="space-y-4">
              <Stepper currentStage={stage} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4" />
                  {t('演示标题')}
                </label>
                <input
                  type="text"
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:ring-2 focus:border-transparent text-sm font-medium"
                  style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                />
                {plan.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    {plan.description}
                  </p>
                )}
              </div>

              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {editableSlides.map((slide, sIdx) => {
                  const label = getPageTypeLabel(slide.pageType);
                  return (
                    <div
                      key={sIdx}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: accentColor }}
                        >
                          {sIdx + 1}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md text-xs font-medium text-white"
                          style={{ backgroundColor: accentColor }}
                        >
                          {label}
                        </span>
                        <input
                          type="text"
                          value={slide.title}
                          onChange={(e) => updateSlideTitle(sIdx, e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white rounded-lg text-sm font-medium focus:ring-2 focus:border-transparent outline-none"
                          style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                        />
                      </div>

                      <div className="space-y-2 ml-8">
                        {slide.keyPoints.map((point, pIdx) => (
                          <div key={pIdx} className="flex items-center gap-2">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: accentColor }}
                            ></span>
                            <input
                              type="text"
                              value={point}
                              onChange={(e) => updateKeyPoint(sIdx, pIdx, e.target.value)}
                              className="flex-1 px-3 py-1.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-white rounded-lg text-sm focus:ring-2 focus:border-transparent outline-none"
                              style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                            />
                            <button
                              type="button"
                              onClick={() => removeKeyPoint(sIdx, pIdx)}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addKeyPoint(sIdx)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-slate-300 dark:border-slate-500 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-400 transition-colors"
                        >
                          {t('+ 添加要点')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stage === 'design' && !layoutLoading && (
            <div className="space-y-4">
              <Stepper currentStage={stage} />
              <div className="text-center mb-2">
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {t('选择视觉风格')}
                </h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {t('AI 根据内容推荐了 3 套设计方案，点击选择你喜欢的风格')}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {designProposals.map((proposal) => {
                  const isSelected = selectedDesign?.id === proposal.id;
                  return (
                    <div
                      key={proposal.id}
                      onClick={() => setSelectedDesign(proposal)}
                      className={`rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${
                        isSelected
                          ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      <div className="relative">
                        <div
                          className="w-full overflow-hidden bg-slate-100 flex items-center justify-center"
                          style={{ aspectRatio: '1280 / 720' }}
                        >
                          <HtmlPreview html={proposal.coverHtml} fit />
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-bold text-sm text-slate-900 dark:text-white">
                            {proposal.name}
                          </p>
                          <span
                            className="w-4 h-4 rounded-full border border-slate-200"
                            style={{ backgroundColor: proposal.primaryColor }}
                          />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                          {proposal.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stage === 'layout-preview' && (
            <div className="space-y-4">
              <Stepper currentStage={stage} />
              <div className="text-center mb-2">
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {t('预览页面排版')}
                </h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {mode === 'collaborative'
                    ? t('逐页审核排版，AI已自动评审，未通过页面可手动重新生成')
                    : inlineSelfCheckEnabled
                      ? t('每页已通过AI设计评审，确认后将开始生成配图和最终润色')
                      : t('检查每页排版结构，确认后将开始生成配图和最终润色')}
                </p>
              </div>
              {inlineSelfCheckEnabled && (
                <div className="flex items-center justify-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    {t('评审通过')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    {t('评审未通过（已用最佳版本）')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    {t('未开启评审')}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[55vh] overflow-y-auto pr-1">
                {renderedSlides.map((slide, idx) => {
                  const label = getPageTypeLabel(slide.pageType);
                  const isApproved = approvedSlides[idx] !== false;
                  const isRegenerating = regeneratingSlides.has(idx);
                  const critique = slide.critique;
                  const hasCritique = !!critique;
                  const critiquePassed = critique?.passed ?? false;
                  const score = critique?.score;
                  const attempts = critique?.attempts ?? 0;
                  const issues = critique?.issues ?? [];
                  const isExpanded = expandedSlide === idx;
                  const scoreColor = !hasCritique
                    ? 'text-slate-400 bg-slate-100 dark:bg-slate-700'
                    : critiquePassed
                      ? 'text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300'
                      : 'text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300';
                  const scoreDot = !hasCritique
                    ? 'bg-slate-400'
                    : critiquePassed
                      ? 'bg-green-500'
                      : 'bg-amber-500';
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border-2 overflow-hidden transition-all ${
                        isApproved
                          ? hasCritique && !critiquePassed
                            ? 'border-amber-300 dark:border-amber-700'
                            : 'border-slate-200 dark:border-slate-600'
                          : 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                      } ${isRegenerating ? 'opacity-60' : ''}`}
                    >
                      <div
                        className="relative bg-slate-100 flex items-center justify-center w-full"
                        style={{ aspectRatio: '1280 / 720' }}
                      >
                        {isRegenerating ? (
                          <div className="flex flex-col items-center gap-2 text-slate-400">
                            <RefreshCw className="w-6 h-6 animate-spin" />
                            <span className="text-xs">{t('重新生成中...')}</span>
                          </div>
                        ) : (
                          <HtmlPreview html={slide.html} fit />
                        )}
                        {hasCritique && (
                          <div
                            className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreColor}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${scoreDot}`}></span>
                            {score?.toFixed(1)}
                            {attempts > 1 && <span className="opacity-70">×{attempts}</span>}
                          </div>
                        )}
                        {mode === 'collaborative' && !isRegenerating && (
                          <button
                            type="button"
                            onClick={() => toggleApprovedSlide(idx)}
                            className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                              isApproved
                                ? 'bg-green-500 text-white'
                                : 'bg-white border-2 border-amber-400 text-amber-500'
                            }`}
                          >
                            {isApproved ? <Check className="w-4 h-4" /> : '!'}
                          </button>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-blue-500">
                            {label}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {slide.title}
                        </p>
                        {hasCritique && issues.length > 0 && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setExpandedSlide(isExpanded ? null : idx)}
                              className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              {issues.length}
                              {t('个设计问题')}
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                            {isExpanded && (
                              <ul className="mt-1.5 space-y-1">
                                {issues.slice(0, 5).map((issue, i) => (
                                  <li
                                    key={i}
                                    className="text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-1"
                                  >
                                    <span className="text-amber-500 mt-0.5">•</span>
                                    <span className="line-clamp-2">{issue}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        {(mode === 'collaborative' || (hasCritique && !critiquePassed)) &&
                          !isRegenerating && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateSlide(idx)}
                              className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" />
                              {t('重新生成此页')}
                            </button>
                          )}
                        {!isApproved && mode === 'collaborative' && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                            {t('未通过用户审核，点击右上角标记可恢复')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stage === 'generating' && (
            <div className="py-8 text-center">
              <Stepper currentStage={stage} />
              <div className="w-16 h-16 mx-auto mb-4 relative">
                <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-blue-500" />
              </div>
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {progress.message || t('AI 正在生成演示文稿...')}
              </p>
              <div className="mt-3">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full font-mono text-lg font-semibold">
                  ⏱️ {formatClockTime(elapsedTime)}
                </span>
              </div>
              {progress.total > 0 && (
                <>
                  <div className="w-full max-w-xs mx-auto mt-4 bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                    {progress.current} / {progress.total}
                  </p>
                </>
              )}
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                {t('正在根据大纲逐页生成幻灯片内容，配图会根据布局自动选择尺寸')}
              </p>
            </div>
          )}

          {stage === 'done' && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('演示文稿生成成功！')}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {t('即将打开编辑器...')}
              </p>
            </div>
          )}
        </div>

        {stage === 'config' && !planLoading && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm font-medium"
            >
              {t('取消')}
            </button>
            <button
              onClick={handleGeneratePlan}
              disabled={!topic.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {primaryButtonText}
            </button>
          </div>
        )}

        {stage === 'outline' && !designLoading && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-between gap-3">
            <button
              onClick={() => setStage('config')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('返回修改')}
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleGeneratePlan}
                disabled={planLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${planLoading ? 'animate-spin' : ''}`} />
                {t('重新生成大纲')}
              </button>
              <button
                onClick={handleConfirmOutline}
                disabled={designLoading}
                className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4" />
                {t('确认大纲，继续')}
              </button>
            </div>
          </div>
        )}

        {stage === 'design' && !layoutLoading && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-between gap-3">
            <button
              onClick={() => setStage('outline')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('返回大纲')}
            </button>
            <button
              onClick={handleSelectDesignAndRender}
              disabled={!selectedDesign || layoutLoading}
              className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              {t('使用此方案，生成页面')}
            </button>
          </div>
        )}

        {stage === 'layout-preview' && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-between gap-3">
            <button
              onClick={() => setStage('design')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('返回设计')}
            </button>
            <button
              onClick={runGuidedFinalize}
              className="inline-flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium"
            >
              <Sparkles className="w-4 h-4" />
              {t('确认排版，开始生成配图与终稿')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
