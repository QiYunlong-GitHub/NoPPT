import type { AuditContext, AuditEngineResult, AuditIssue } from '../../types';

/**
 * AC-8 / Task10c: Sanitization Audit Engine（纯本地扫描，不依赖 LLM/Playwright）。
 *
 * 作用：
 *   读取 presentation.slides[i]._sanitizationFallbackApplied（由 server 侧 finalGuard
 *   在触发 `buildFallbackSlideHtml` 主色降级时写入），将其转换为结构化 AuditIssue
 *   写入 audit report → latest-report.json 直接可见，不再是隐式事件。
 *
 * 设计原则：
 *   - 零依赖：不调用 LLM、不启动 Playwright，执行耗时 ≈ O(n) 读标记；
 *   - 静默容错：只要无标记就给出满分 100 的 pass 结果；
 *   - 不与旧字段（sanitizationFailed）耦合，消费端只看 slide 上的 per-slide 标记（因为
 *     sanitizationFailed 可能被前端过滤掉，但 slide 标记始终跟 presentation.slides 一起写盘存档）。
 */

export interface SanitizationFallbackMarker {
  index: number;
  title?: string;
  remain: number;
  breakdown: {
    neutralFont22_29: number;
    neutralPxSticky: number;
    colorViolations: number;
    total: number;
  };
  samples?: Record<string, string[]>;
  expectedPrimary?: string;
  fallbackApplied?: boolean;
}

const RULE_ID = 'sanitization-fallback-applied';

function summarizeSamples(samples?: Record<string, string[]>): string {
  if (!samples) return '';
  const parts: string[] = [];
  for (const key of Object.keys(samples)) {
    const list = samples[key] || [];
    if (list.length === 0) continue;
    const preview = list.slice(0, 3).join('；');
    parts.push(`${key}(${list.length})[${preview}]`);
  }
  return parts.join(' / ');
}

export class SanitizationAuditEngine {
  async audit(context: AuditContext): Promise<AuditEngineResult> {
    const start = Date.now();
    const issues: AuditIssue[] = [];
    const slides = context?.presentation?.slides || [];
    let matched = 0;

    for (let i = 0; i < slides.length; i++) {
      const s = slides[i] as any;
      const marker = s?._sanitizationFallbackApplied as SanitizationFallbackMarker | undefined;
      if (!marker || !marker.fallbackApplied) continue;
      matched++;
      const bd = marker.breakdown || {
        neutralFont22_29: 0,
        neutralPxSticky: 0,
        colorViolations: 0,
        total: marker.remain || 0,
      };
      const detailParts: string[] = [];
      detailParts.push(
        `三分量越权合计=${marker.remain ?? bd.total ?? 0}`,
        `(neutralFont22_29=${bd.neutralFont22_29}, neutralPxSticky=${bd.neutralPxSticky}, colorViolations=${bd.colorViolations})`,
      );
      if (marker.expectedPrimary) detailParts.push(`期望主色=${marker.expectedPrimary}`);
      const sampleSummary = summarizeSamples(marker.samples);
      if (sampleSummary) detailParts.push(`采样=${sampleSummary}`);
      const suggestion =
        '请在编辑器页点击该页「单页重生成」，或核对 design.primaryColor 与 LLM 返回是否一致；' +
        '若持续发生，请检查 postProcessLayout 链 / enforceSinglePalette 是否错误移除了同色系渐变。';
      issues.push({
        ruleId: RULE_ID,
        severity: 'error',
        engine: 'sanitization',
        slideIndex: i,
        message:
          `本页触发 finalGuard，已替换为主色化兜底 fallback 页。` +
          `原因：styleViolationSignal 二次消毒后仍超阈值。${detailParts.join('；')}`,
        fixSuggestion: suggestion,
        fixable: false,
        metadata: {
          sanitization: {
            markerIndex: marker.index,
            remain: marker.remain ?? bd.total ?? 0,
            breakdown: bd,
            expectedPrimary: marker.expectedPrimary ?? null,
            samples: marker.samples ?? null,
          },
        },
      });
    }

    // 评分：无标记 = 100 pass；有标记按匹配页数扣分（10 页 1 页扣 10 → 90，但因为 severity=error 仍会 fail 总评）
    const total = Math.max(1, slides.length);
    const score = Math.max(0, Math.round(100 * (1 - matched / total)));
    const hasError = issues.some((x) => x.severity === 'error');
    const status: AuditEngineResult['status'] = hasError ? 'fail' : matched > 0 ? 'warn' : 'passed';

    return {
      engine: 'sanitization',
      engineName: 'Sanitization Fallback Audit Engine',
      status,
      score,
      issues,
      durationMs: Date.now() - start,
    };
  }
}
