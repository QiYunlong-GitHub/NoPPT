import type {
  CollabMode,
  ColorTheme,
  Density,
  FontFamily,
  ImagePref,
  PipelineStage,
  SlideCountMode,
} from './ai-generate/types';
import { COLOR_THEME_IDS, ICON_STYLE_IDS, audienceOptions, fontFamilyOptions, colorThemeOptions } from './ai-generate/options';
import { useGenerateState } from './ai-generate/useGenerateState';
import { Stepper } from './ai-generate/preview';
import { ConfigPanel } from './ai-generate/ConfigPanel';
import { OutlineEditor } from './ai-generate/OutlineEditor';
import { DesignProposals } from './ai-generate/DesignProposals';
import { RenderedSlides } from './ai-generate/RenderedSlides';
import { t } from '@/i18n';
import { useRef, useEffect } from 'react';
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
export default function AIGenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  const consumeAIPrefill = useUIStore((s) => s.consumeAIPrefill);
  const settings = useSettingsStore();
  const presentation = usePresentationStore((s) => s.presentation);
  const setPresentation = usePresentationStore((s) => s.setPresentation);
  const savePresentation = usePresentationStore((s) => s.savePresentation);
  const addChatMessage = usePresentationStore((s) => s.addChatMessage);
  const {
    // 生成入参
    topic,
    setTopic,
    style,
    setStyle,
    density,
    setDensity,
    imagePreference,
    setImagePreference,
    colorTheme,
    setColorTheme,
    backgroundEnabled,
    setBackgroundEnabled,
    autoAuditEnabled,
    setAutoAuditEnabled,
    inlineSelfCheckEnabled,
    setInlineSelfCheckEnabled,
    iconStyle,
    setIconStyle,
    slideCountMode,
    setSlideCountMode,
    exactSlideCount,
    setExactSlideCount,
    minSlideCount,
    setMinSlideCount,
    maxSlideCount,
    setMaxSlideCount,
    audience,
    setAudience,
    fontFamily,
    setFontFamily,
    genLanguage,
    setGenLanguage,
    // 参考素材
    referenceHtml,
    setReferenceHtml,
    referenceHtmlName,
    setReferenceHtmlName,
    referenceImage,
    setReferenceImage,
    referenceImageName,
    setReferenceImageName,
    referenceHtmlCover,
    setReferenceHtmlCover,
    referenceHtmlCoverName,
    setReferenceHtmlCoverName,
    referenceImageCover,
    setReferenceImageCover,
    referenceImageCoverName,
    setReferenceImageCoverName,
    referenceImageCoverOriginal,
    setReferenceImageCoverOriginal,
    referenceHtmlContent,
    setReferenceHtmlContent,
    referenceHtmlContentName,
    setReferenceHtmlContentName,
    referenceImageContent,
    setReferenceImageContent,
    referenceImageContentName,
    setReferenceImageContentName,
    referenceImageContentOriginal,
    setReferenceImageContentOriginal,
    referenceHtmlSummary,
    setReferenceHtmlSummary,
    referenceHtmlSummaryName,
    setReferenceHtmlSummaryName,
    referenceImageSummary,
    setReferenceImageSummary,
    referenceImageSummaryName,
    setReferenceImageSummaryName,
    referenceImageSummaryOriginal,
    setReferenceImageSummaryOriginal,
    refAttrsVersion,
    setRefAttrsVersion,
    referenceText,
    setReferenceText,
    referenceSource,
    setReferenceSource,
    draftReferenceLimit,
    setDraftReferenceLimit,
    referenceTruncated,
    setReferenceTruncated,
    referenceOriginalChars,
    setReferenceOriginalChars,
    referenceInitial,
    setReferenceInitial,
    showReference,
    setShowReference,
    // 流程状态
    loading,
    setLoading,
    progress,
    setProgress,
    elapsedTime,
    setElapsedTime,
    showAdvanced,
    setShowAdvanced,
    stage,
    setStage,
    mode,
    setMode,
    planLoading,
    setPlanLoading,
    designLoading,
    setDesignLoading,
    layoutLoading,
    setLayoutLoading,
    // 生成结果
    plan,
    setPlan,
    editableSlides,
    setEditableSlides,
    editableTitle,
    setEditableTitle,
    designProposals,
    setDesignProposals,
    selectedDesign,
    setSelectedDesign,
    renderedSlides,
    setRenderedSlides,
    approvedSlides,
    setApprovedSlides,
    regeneratingSlides,
    setRegeneratingSlides,
    expandedSlide,
    setExpandedSlide,
  } = useGenerateState(settings);
  const refAttrsVersionRef = useRef<string | undefined>(undefined);
  // —— 参考素材（RAG / 对话上下文整理的「权威素材」）——
  // planning 阶段会作为「权威素材」段注入大纲 prompt（后端 GeneratePresentationRequest.referenceText）。
  const referenceTextRef = useRef<string>('');
  /** 统一写入：state 与 ref 必须同步更新。 */
  const updateReferenceText = (value: string) => {
    referenceTextRef.current = value;
    setReferenceText(value);
  };
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
          <ConfigPanel
            stage={stage}
            planLoading={planLoading}
            setMode={setMode}
            mode={mode}
            topic={topic}
            setTopic={setTopic}
            setShowReference={setShowReference}
            showReference={showReference}
            referenceText={referenceText}
            referenceSource={referenceSource}
            referenceTruncated={referenceTruncated}
            referenceOriginalChars={referenceOriginalChars}
            referenceInitial={referenceInitial}
            setStyle={setStyle}
            style={style}
            setShowAdvanced={setShowAdvanced}
            showAdvanced={showAdvanced}
            setSlideCountMode={setSlideCountMode}
            slideCountMode={slideCountMode}
            setExactSlideCount={setExactSlideCount}
            exactSlideCount={exactSlideCount}
            minSlideCount={minSlideCount}
            setMinSlideCount={setMinSlideCount}
            maxSlideCount={maxSlideCount}
            setMaxSlideCount={setMaxSlideCount}
            audience={audience}
            setAudience={setAudience}
            setGenLanguage={setGenLanguage}
            genLanguage={genLanguage}
            setFontFamily={setFontFamily}
            fontFamily={fontFamily}
            setBackgroundEnabled={setBackgroundEnabled}
            backgroundEnabled={backgroundEnabled}
            setAutoAuditEnabled={setAutoAuditEnabled}
            autoAuditEnabled={autoAuditEnabled}
            setInlineSelfCheckEnabled={setInlineSelfCheckEnabled}
            inlineSelfCheckEnabled={inlineSelfCheckEnabled}
            setColorTheme={setColorTheme}
            colorTheme={colorTheme}
            setDensity={setDensity}
            density={density}
            setImagePreference={setImagePreference}
            imagePreference={imagePreference}
            setIconStyle={setIconStyle}
            iconStyle={iconStyle}
            renderReferenceRow={renderReferenceRow}
            renderCategoryCard={renderCategoryCard}
            handleReferenceFileChange={handleReferenceFileChange}
            updateReferenceText={updateReferenceText}
            effectiveReferenceLimit={effectiveReferenceLimit}
            referenceOverLimit={referenceOverLimit}
            htmlInputRef={htmlInputRef}
            imageInputRef={imageInputRef}
          />

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

          <OutlineEditor
            stage={stage}
            plan={plan}
            designLoading={designLoading}
            editableTitle={editableTitle}
            setEditableTitle={setEditableTitle}
            editableSlides={editableSlides}
            accentColor={accentColor}
            updateSlideTitle={updateSlideTitle}
            updateKeyPoint={updateKeyPoint}
            removeKeyPoint={removeKeyPoint}
            addKeyPoint={addKeyPoint}
          />

          <DesignProposals
            stage={stage}
            layoutLoading={layoutLoading}
            designProposals={designProposals}
            selectedDesign={selectedDesign}
            setSelectedDesign={setSelectedDesign}
          />

          <RenderedSlides
            stage={stage}
            mode={mode}
            inlineSelfCheckEnabled={inlineSelfCheckEnabled}
            renderedSlides={renderedSlides}
            approvedSlides={approvedSlides}
            regeneratingSlides={regeneratingSlides}
            expandedSlide={expandedSlide}
            setExpandedSlide={setExpandedSlide}
            toggleApprovedSlide={toggleApprovedSlide}
            handleRegenerateSlide={handleRegenerateSlide}
          />

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
