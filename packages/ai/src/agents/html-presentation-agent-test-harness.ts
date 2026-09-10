// ============================================================
// 测试专用 harness — 将 html-presentation-agent.ts 内部未 export 的函数暴露给单测
// 本文件在 tsc 构建时不会被业务代码 import，仅用于 vitest
// ================================================================
// ⚠️ 注意：需要在 html-presentation-agent.ts 末尾新增 TEST HARNESS EXPORT
//    段，显式 export 以下函数和常量。
// ================================================================

export {
  COLOR_THEMES,
  resolveEffectivePrimaryColor,
  resolveProposalPrimaryColor,
  darkenColor,
  assertHueClose,
  computeU17EffectivePrimaryColor,
  buildPlanningMessagesForTest,
} from './html-presentation-agent';
