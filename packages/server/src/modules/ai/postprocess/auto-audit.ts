// 自动审核阶段（从 postProcessPresentationImpl 外置，行为零变更）。
// 该段完全自包含：仅在内部消费局部变量并写日志/写盘，无输出回传调用方。
import type { ReferenceContext } from '@noppt/ai';
import { formatBeijingTime, simpleLog } from '@noppt/ai';
import { sanitizeHtmlServerSide } from '../../../utils/sanitize';
import { join } from 'path';
import { tagAuditProviderError } from './html-helpers';

export async function runAutoAudit(ctx: any): Promise<void> {
  const self = ctx.self;
  const {
    result,
    plan,
    presentation,
    design,
    agent,
    generationOptions,
    enableAudit,
    finalEffectivePrimary,
    style,
    fontFamily,
    iconStyle,
    contentConfig,
    imageConfig,
    imageProvider,
    traceSessionId,
    topic,
    colorTheme,
    finalWidth,
    finalHeight,
  } = ctx;

    // =============== 自动审核（可选，enableAudit=true 时触发）===============
    // 在终局写盘之后执行：布局自动修复 + 视觉/内容/保真度量化评估 + 报告持久化。
    // 审核失败绝不阻断主流程，仅记录日志。
    // 生效优先级：请求显式传入 enableAudit > 全局 auditSettings.enabled
    // FR-3(e) / FR-7 / AC-5：audit designContext.primaryColor 必须使用单源 finalEffectivePrimary，
    // 禁止使用默认蓝 #2563eb（否则 Content 引擎文案出现"主色 #2563eb 未使用"这种与配置矛盾的 fatal 级 issue，
    // 同时错误分诊导致 regenerateSingleSlide 预算耗尽 fallback）。
    const auditMainColor = finalEffectivePrimary;
    const auditDesignContext = {
      style: style || 'business',
      primaryColor: auditMainColor,
      fontFamily: fontFamily || 'sans',
      iconStyle: iconStyle || 'auto',
    };
    // 原则 P-2 / FR-17.2：从生成请求的参考属性推导 hasReference，让 audit 引擎感知"本演示遵循用户参考意图"，
    // 从而在通用规范类偏差上放宽（不判 fatal），仅在 L0 无障碍底线上否决。
    const referenceContext: ReferenceContext | undefined = (() => {
      const rva = (generationOptions as any)?.referenceVisualAttributes;
      if (!rva) return undefined;
      const cats = rva.byCategory || {};
      const anyUploaded =
        !!rva.global?.uploaded ||
        !!cats.cover?.uploaded ||
        !!cats.content?.uploaded ||
        !!cats.summary?.uploaded;
      if (!anyUploaded) return undefined;
      const source: 'html' | 'image' | 'none' =
        rva.source === 'image-only' ? 'image' : rva.source === 'html-only' ? 'html' : 'html';
      const appliedFields: string[] = [];
      for (const c of ['cover', 'content', 'summary', 'global'] as const) {
        const cr = c === 'global' ? rva.global : cats[c];
        if (cr?.uploaded) appliedFields.push(c);
      }
      return { hasReference: true, source, appliedFields };
    })();
    let auditEnabled = enableAudit;
    let auditAppConfig: any = null;
    if (auditEnabled === undefined) {
      try {
        auditAppConfig = await self.configService.getConfig();
        auditEnabled = auditAppConfig.auditSettings?.enabled ?? false;
      } catch {
        auditEnabled = false;
      }
    }
    if (auditEnabled) {
      try {
        if (!auditAppConfig) {
          auditAppConfig = await self.configService.getConfig();
        }
        const auditSettings = auditAppConfig.auditSettings || {};
        const maxRegenRetries = auditSettings.maxRegenerationRetries ?? 0;

        // ——— 第 1 步：初次审核（全引擎 + 布局自动修复）———
        const auditResult = await self.auditService.auditPresentationFromData(result, result.id, {
          plan,
          designContext: auditDesignContext,
          referenceContext,
        });
        const errorCount = auditResult.issues.filter((i) => i.severity === 'error').length;
        const warnCount = auditResult.issues.filter((i) => i.severity === 'warn').length;
        const fixedCount = auditResult.fixSummary?.fixedCount ?? 0;

        if (auditResult.fixSummary && auditResult.fixSummary.fixedCount > 0) {
          for (let i = 0; i < result.slides.length; i++) {
            result.slides[i].html = sanitizeHtmlServerSide(result.slides[i].html);
          }
          result.updatedAt = Date.now();
          await self.storage.writeJsonFile(
            join(self.storage.getPresentationDir(result.id), 'presentation.json'),
            result,
          );
        }

        // —— 模型档位建议（仅 flash 档 + 审核有 error 时给出，不弹窗）——
        if (
          errorCount > 0 &&
          /flash/i.test(String(contentConfig?.model || '')) &&
          !/plus|max/i.test(String(contentConfig?.model || ''))
        ) {
          (result as any).modelRecommendation = {
            message: '建议将生成模型提升至 plus / max 档以降低重复生成与质量返工',
            model: contentConfig?.model || '',
          };
          simpleLog('AI:MODEL', '模型档位建议', { model: contentConfig?.model });
        }

        // ——— 第 2 步：图片插入后的 VLM 分诊闭环 ———
        // VLM 评审带图幻灯片，根据 rootCause 分诊为 HTML/图片/二者，精准重生成。
        // 最多重试 maxRegenerationRetries 次，触发上限后保留最优版本。
        let imageRegenCount = 0;
        let imageRegenAttempts = 0;
        if (imageProvider && maxRegenRetries > 0 && auditSettings.vlmReview !== false && agent) {
          try {
            const triageResult = await self.runPostImageVlmTriageLoop({
              result,
              plan: plan || (presentation as any).plan,
              design: design || (presentation as any).design,
              agent,
              imageProvider,
              imageOptions: imageConfig?.enabled
                ? {
                    model: imageConfig.model,
                    size: imageConfig.size,
                    quality: imageConfig.quality,
                  }
                : undefined,
              traceSessionId,
              topic,
              maxRetries: maxRegenRetries,
              slideWidth: finalWidth,
              slideHeight: finalHeight,
              generationOptions: generationOptions || {},
              primaryColor: finalEffectivePrimary,
              colorTheme,
            });
            imageRegenCount = triageResult.regeneratedCount;
            imageRegenAttempts = triageResult.attempts;

            // ——— 第 3 步：最终审核（仅在确实重生成了内容时执行，刷新 latest-report.json 反映最终画面）———
            if (imageRegenCount > 0) {
              await self.auditService.auditPresentationFromData(result, result.id, {
                plan,
                designContext: auditDesignContext,
                referenceContext,
              });
            }
          } catch (regenErr) {
            console.warn(
              `${formatBeijingTime()} ${tagAuditProviderError('[AI:AUDIT-IMG] VLM 分诊重生成闭环异常（不影响生成结果）', regenErr)}:`,
              regenErr instanceof Error ? regenErr.message : regenErr,
            );
          }
        }

        simpleLog('AI:AUDIT', '自动审核完成', {
          id: result.id,
          score: auditResult.overallScore,
          result: auditResult.overallResult,
          errors: errorCount,
          warns: warnCount,
          autoFixed: fixedCount,
          imageRegenerated: imageRegenCount,
          imageRegenAttempts,
          regenerationRequired: auditResult.regenerationRequired,
        });
      } catch (auditErr) {
        console.warn(
          `${formatBeijingTime()} ${tagAuditProviderError('[AI:AUDIT] 审核流程异常（不影响生成结果）', auditErr)}:`,
          auditErr instanceof Error ? auditErr.message : auditErr,
        );
      }
    }
}
