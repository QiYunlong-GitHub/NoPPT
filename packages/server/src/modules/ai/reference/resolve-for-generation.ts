/**
 * 「参考注入」与「5 级 single-source primary 链」的纯函数实现（从 ai.service.ts 外置）。
 *
 * - resolveReferenceForGeneration：统一聚合「参考视觉属性 + brief + 版本/来源」，供所有生成入口复用。
 *   resolveReferenceVisualAttributes（仍留在 ai.service，依赖 LLM/VLM）通过参数注入，保持门面不变。
 * - resolveFinalEffectivePrimary：5 级 single-source primary 链（参考 deck 主色 > 用户 > design > 默认蓝）。
 *
 * ai.service.ts 保留对应 private 方法作为薄委托，调用方与 Phase 4 测试网不变。
 */
import {
  resolveDeckReferencePrimaryColor,
  resolveEffectivePrimaryColor,
  type ReferenceVisualAttributes,
} from '@noppt/ai';
import type { GeneratePresentationRequest } from '../ai.service';
import { buildReferenceBrief } from './reference-brief';

export interface ResolveReferenceVisualAttributesResult {
  referenceVisualAttributes: ReferenceVisualAttributes | null;
  refAttrsVersion: string;
  source: string;
}

/**
 * 统一解析「参考视觉属性 + 参考 HTML 摘要(brief)」，供所有生成入口（plan / design-proposals /
 * generateFromPlan / renderSlides / regenerateSlide / assembleImages / finalizePresentation）复用。
 * resolveReferenceVisualAttributes 由调用方注入（ai.service 中的 private 实现依赖 DI 成员）。
 */
export async function resolveReferenceForGeneration(
  req: GeneratePresentationRequest,
  resolveReferenceVisualAttributes: (
    req: GeneratePresentationRequest,
  ) => Promise<ResolveReferenceVisualAttributesResult>,
): Promise<{
  referenceVisualAttributes?: ReferenceVisualAttributes;
  referenceHtmlBrief: string;
  refAttrsVersion: string;
}> {
  const { referenceVisualAttributes, refAttrsVersion, source } =
    await resolveReferenceVisualAttributes(req);
  const referenceHtmlBrief = buildReferenceBrief(referenceVisualAttributes);
  // 可观测：统一在生成入口记录四类参考 HTML 长度与 brief 长度、版本号与来源，
  // 便于在报文/日志中判断"参考文件是否上传成功、抽到了哪些内容"。
  const htmlCover = req.referenceHtmlCover ?? '';
  const htmlContent = req.referenceHtmlContent ?? '';
  const htmlSummary = req.referenceHtmlSummary ?? '';
  const htmlGlobal = req.referenceHtmlGlobal ?? req.referenceHtml ?? '';
  console.log(
    `[REF-GEN] refAttrsVersion=${refAttrsVersion} source=${source} ` +
      `htmlLen: cover=${htmlCover.length} content=${htmlContent.length} summary=${htmlSummary.length} global=${htmlGlobal.length} ` +
      `briefLen=${referenceHtmlBrief.length} rva=${referenceVisualAttributes ? 'present' : 'null'}`,
  );
  return {
    referenceVisualAttributes: referenceVisualAttributes ?? undefined,
    referenceHtmlBrief,
    refAttrsVersion,
  };
}

/**
 * 5 级 single-source primary 链：参考 deck 主色优先（single-source：参考 > 用户 > 默认蓝），
 * 回落到 resolveEffectivePrimaryColor（用户 primaryColor/colorTheme > design > 默认蓝）。
 * 并就地写回 presentation.design.primaryColor/colorTheme 与 generationOptions.primaryColor/colorTheme。
 */
export function resolveFinalEffectivePrimary(
  presentation: { design?: any },
  generationOptions: any,
  opts: { primaryColor?: string; colorTheme?: any; design?: any },
): string {
  const { primaryColor, colorTheme, design } = opts;
  const refDeckPrimaryForFinal = resolveDeckReferencePrimaryColor(
    (generationOptions as any)?.referenceVisualAttributes ?? null,
  );
  const finalEffectivePrimary = refDeckPrimaryForFinal
    ? refDeckPrimaryForFinal
    : resolveEffectivePrimaryColor(
        { primaryColor, colorTheme },
        {
          primaryColor:
            (design as any)?.primaryColor ?? (presentation as any).design?.primaryColor,
          colorTheme: (design as any)?.colorTheme ?? (presentation as any).design?.colorTheme,
        },
        '#2563eb',
      );
  {
    const presDesign = (presentation as any).design;
    if (presDesign && typeof presDesign === 'object') {
      if (
        presDesign.primaryColor &&
        presDesign.primaryColor.toLowerCase() !== finalEffectivePrimary
      ) {
        console.warn(
          `[DESIGN] presentation.design.primaryColor(${presDesign.primaryColor}) 与 5 级链结果(${finalEffectivePrimary}) 不一致，已覆盖（colorTheme=${colorTheme ?? 'N/A'} primaryColorOption=${primaryColor ?? 'N/A'}）。`,
        );
      }
      presDesign.primaryColor = finalEffectivePrimary;
      if (colorTheme) presDesign.colorTheme = colorTheme;
    }
  }
  if (generationOptions) {
    generationOptions.primaryColor = finalEffectivePrimary;
    if (colorTheme) generationOptions.colorTheme = colorTheme;
  }
  console.log(
    `[DESIGN-SINGLE-SOURCE] 终局 primaryColor=${finalEffectivePrimary}（用户 primaryColor=${
      primaryColor ?? 'N/A'
    } | colorTheme=${colorTheme ?? 'N/A'} | design.colorTheme=${
      (design as any)?.colorTheme ?? 'N/A'
    } | design.primaryColor=${(design as any)?.primaryColor ?? 'N/A'}${refDeckPrimaryForFinal ? ` | refDeckPrimary=${refDeckPrimaryForFinal} reference-first` : ''}）。`,
  );
  return finalEffectivePrimary;
}
