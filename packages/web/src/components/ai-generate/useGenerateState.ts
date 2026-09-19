/**
 * AIGenerateModal 的状态层（由组件内 55 个 useState 收敛而来）。
 *
 * 设计要点：
 *  1. 按职责分为 4 组：form（生成入参）/ reference（参考素材）/ flow（流程状态）/ result（生成结果）。
 *  2. 对外**保持与 useState 完全一致的 API**：每个字段仍然暴露 `value` 与 `setXxx`，
 *     且 setter 同样支持「直接传值」与「传更新函数」两种用法，因此组件内 1200 行 JSX
 *     与所有 handler 均无需改动。
 *  3. setter 通过 useMemo 依赖稳定的 dispatch 生成，身份在整个生命周期内不变，
 *     不会因 setter 身份变化触发 useEffect 重跑（useState setter 同样是稳定身份）。
 *  4. 惰性初始化（依赖 settings 的两个开关）通过 useReducer 的第三参数实现，
 *     与原先 useState(() => ...) 语义一致。
 */
import { useMemo, useReducer, type Dispatch } from 'react';
import { t } from '@/i18n';
import type {
  ColorTheme,
  CollabMode,
  Density,
  FontFamily,
  ImagePref,
  PipelineStage,
  SlideCountMode,
} from './types';
import type {
  DesignProposal,
  IconStyle,
  PresentationPlan,
  RenderedSlide,
  SlidePlan,
} from '@noppt/ai';

/**
 * 只声明本 Hook 真正用到的 settings 字段（结构化类型）。
 * 不直接复用 useSettingsStore 的返回类型，避免把整个 store 的形状耦合进状态层。
 */
interface SettingsState {
  auditSettings?: { enabled?: boolean };
  inlineSelfCheckSettings?: { enabled?: boolean };
}

type Updater<V> = V | ((prev: V) => V);
/** setter 名为 `set` + 字段名首字母大写，与 useState 的命名保持一致 */
type SettersOf<S> = {
  [K in keyof S & string as `set${Capitalize<K>}`]: (v: Updater<S[K]>) => void;
};
type GroupAction<S> = { [K in keyof S]: { key: K; value: Updater<S[K]> } }[keyof S];

/** 与 useState 等价的分组 reducer：支持直接赋值与函数式更新 */
function makeReducer<S extends object>() {
  return (state: S, action: GroupAction<S>): S => {
    const current = state[action.key as keyof S];
    const raw = action.value as unknown;
    const next = typeof raw === 'function' ? (raw as (prev: unknown) => unknown)(current) : raw;
    return { ...state, [action.key]: next } as S;
  };
}

function makeSetters<S extends object>(
  dispatch: Dispatch<GroupAction<S>>,
  keys: (keyof S & string)[],
): SettersOf<S> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const setterName = `set${key[0].toUpperCase()}${key.slice(1)}`;
    out[setterName] = (value: unknown) =>
      dispatch({ key, value } as unknown as GroupAction<S>);
  }
  return out as SettersOf<S>;
}

/* ------------------------------------------------------------------ 分组 1：生成入参 */
interface FormState {
  topic: string;
  style: 'business' | 'creative' | 'simple' | 'academic';
  density: Density;
  imagePreference: ImagePref;
  colorTheme: ColorTheme | '';
  backgroundEnabled: boolean;
  autoAuditEnabled: boolean;
  inlineSelfCheckEnabled: boolean;
  iconStyle: IconStyle;
  slideCountMode: SlideCountMode;
  exactSlideCount: number;
  minSlideCount: number;
  maxSlideCount: number;
  audience: string;
  fontFamily: FontFamily;
  genLanguage: 'follow' | 'zh-CN' | 'en';
}

const FORM_KEYS: (keyof FormState & string)[] = [
  'topic',
  'style',
  'density',
  'imagePreference',
  'colorTheme',
  'backgroundEnabled',
  'autoAuditEnabled',
  'inlineSelfCheckEnabled',
  'iconStyle',
  'slideCountMode',
  'exactSlideCount',
  'minSlideCount',
  'maxSlideCount',
  'audience',
  'fontFamily',
  'genLanguage',
];

const initialForm = (settings: SettingsState): FormState => ({
  topic: '',
  style: 'business',
  density: 'normal',
  imagePreference: 'content-only',
  colorTheme: '',
  backgroundEnabled: false,
  autoAuditEnabled: settings.auditSettings?.enabled ?? true,
  inlineSelfCheckEnabled: settings.inlineSelfCheckSettings?.enabled ?? true,
  iconStyle: 'auto',
  slideCountMode: 'auto',
  exactSlideCount: 8,
  minSlideCount: 5,
  maxSlideCount: 10,
  audience: t('通用商务受众'),
  fontFamily: 'sans',
  genLanguage: 'follow',
});

const formReducer = makeReducer<FormState>();

/* ------------------------------------------------------------ 分组 2：参考素材 */
interface ReferenceState {
  referenceHtml: string | null;
  referenceHtmlName: string;
  referenceImage: string | null;
  referenceImageName: string;
  referenceHtmlCover: string | null;
  referenceHtmlCoverName: string;
  referenceImageCover: string | null;
  referenceImageCoverName: string;
  referenceImageCoverOriginal: string | null;
  referenceHtmlContent: string | null;
  referenceHtmlContentName: string;
  referenceImageContent: string | null;
  referenceImageContentName: string;
  referenceImageContentOriginal: string | null;
  referenceHtmlSummary: string | null;
  referenceHtmlSummaryName: string;
  referenceImageSummary: string | null;
  referenceImageSummaryName: string;
  referenceImageSummaryOriginal: string | null;
  refAttrsVersion: string | undefined;
  referenceText: string;
  referenceSource: string | undefined;
  draftReferenceLimit: number | undefined;
  referenceTruncated: boolean;
  referenceOriginalChars: number;
  referenceInitial: string;
  showReference: boolean;
}

const REFERENCE_KEYS: (keyof ReferenceState & string)[] = [
  'referenceHtml',
  'referenceHtmlName',
  'referenceImage',
  'referenceImageName',
  'referenceHtmlCover',
  'referenceHtmlCoverName',
  'referenceImageCover',
  'referenceImageCoverName',
  'referenceImageCoverOriginal',
  'referenceHtmlContent',
  'referenceHtmlContentName',
  'referenceImageContent',
  'referenceImageContentName',
  'referenceImageContentOriginal',
  'referenceHtmlSummary',
  'referenceHtmlSummaryName',
  'referenceImageSummary',
  'referenceImageSummaryName',
  'referenceImageSummaryOriginal',
  'refAttrsVersion',
  'referenceText',
  'referenceSource',
  'draftReferenceLimit',
  'referenceTruncated',
  'referenceOriginalChars',
  'referenceInitial',
  'showReference',
];

const initialReference: ReferenceState = {
  referenceHtml: null,
  referenceHtmlName: '',
  referenceImage: null,
  referenceImageName: '',
  referenceHtmlCover: null,
  referenceHtmlCoverName: '',
  referenceImageCover: null,
  referenceImageCoverName: '',
  referenceImageCoverOriginal: null,
  referenceHtmlContent: null,
  referenceHtmlContentName: '',
  referenceImageContent: null,
  referenceImageContentName: '',
  referenceImageContentOriginal: null,
  referenceHtmlSummary: null,
  referenceHtmlSummaryName: '',
  referenceImageSummary: null,
  referenceImageSummaryName: '',
  referenceImageSummaryOriginal: null,
  refAttrsVersion: undefined,
  referenceText: '',
  referenceSource: undefined,
  draftReferenceLimit: undefined,
  referenceTruncated: false,
  referenceOriginalChars: 0,
  referenceInitial: '',
  showReference: false,
};

const referenceReducer = makeReducer<ReferenceState>();

/* ------------------------------------------------------------ 分组 3：流程状态 */
interface FlowState {
  loading: boolean;
  progress: { current: number; total: number; message: string };
  elapsedTime: number;
  showAdvanced: boolean;
  stage: PipelineStage;
  mode: CollabMode;
  planLoading: boolean;
  designLoading: boolean;
  layoutLoading: boolean;
}

const FLOW_KEYS: (keyof FlowState & string)[] = [
  'loading',
  'progress',
  'elapsedTime',
  'showAdvanced',
  'stage',
  'mode',
  'planLoading',
  'designLoading',
  'layoutLoading',
];

const initialFlow: FlowState = {
  loading: false,
  progress: { current: 0, total: 0, message: '' },
  elapsedTime: 0,
  showAdvanced: false,
  stage: 'config',
  mode: 'guided',
  planLoading: false,
  designLoading: false,
  layoutLoading: false,
};

const flowReducer = makeReducer<FlowState>();

/* ------------------------------------------------------------ 分组 4：生成结果 */
interface ResultState {
  plan: PresentationPlan | null;
  editableSlides: SlidePlan[];
  editableTitle: string;
  designProposals: DesignProposal[];
  selectedDesign: DesignProposal | null;
  renderedSlides: RenderedSlide[];
  approvedSlides: boolean[];
  regeneratingSlides: Set<number>;
  expandedSlide: number | null;
}

const RESULT_KEYS: (keyof ResultState & string)[] = [
  'plan',
  'editableSlides',
  'editableTitle',
  'designProposals',
  'selectedDesign',
  'renderedSlides',
  'approvedSlides',
  'regeneratingSlides',
  'expandedSlide',
];

const initialResult: ResultState = {
  plan: null,
  editableSlides: [],
  editableTitle: '',
  designProposals: [],
  selectedDesign: null,
  renderedSlides: [],
  approvedSlides: [],
  regeneratingSlides: new Set<number>(),
  expandedSlide: null,
};

const resultReducer = makeReducer<ResultState>();

/* ------------------------------------------------------------------ 对外 Hook */
export function useGenerateState(settings: SettingsState) {
  const [form, formDispatch] = useReducer(formReducer, undefined, () => initialForm(settings));
  const [reference, referenceDispatch] = useReducer(referenceReducer, initialReference);
  const [flow, flowDispatch] = useReducer(flowReducer, initialFlow);
  const [result, resultDispatch] = useReducer(resultReducer, initialResult);

  const formSetters = useMemo(() => makeSetters(formDispatch, FORM_KEYS), [formDispatch]);
  const referenceSetters = useMemo(
    () => makeSetters(referenceDispatch, REFERENCE_KEYS),
    [referenceDispatch],
  );
  const flowSetters = useMemo(() => makeSetters(flowDispatch, FLOW_KEYS), [flowDispatch]);
  const resultSetters = useMemo(() => makeSetters(resultDispatch, RESULT_KEYS), [resultDispatch]);

  return {
    ...form,
    ...formSetters,
    ...reference,
    ...referenceSetters,
    ...flow,
    ...flowSetters,
    ...result,
    ...resultSetters,
  };
}
