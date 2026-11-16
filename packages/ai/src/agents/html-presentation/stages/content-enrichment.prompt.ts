/**
 * 稀疏页内容扩写提示词。
 *
 * 目标：把规划阶段留下的空洞短句，基于用户原始素材（referenceText）扩写成
 * 「结论 + 证据/数据/机制」的信息密度断言，并按 pageType 产出对应 typed 字段。
 * 只改内容不改版式：pageType 由调用方锁定，prompt 只要求补齐字段。
 */

import type { SlidePlan } from '../../../types';

/** 各 pageType 需要扩写产出哪些 typed 字段，给 LLM 的字段规范摘要。 */
const TYPED_FIELD_RULES: Record<string, string> = {
  'comparison-deep-dive':
    'keyPoints 必须是左右同维度同顺序的成对要点(4-6条,偶数),每条写成「维度：结论+证据」断言;' +
    '左右成对后布局会自动铺满四张卡。不要输出 metricValues/advantageIndices（这些字段仅用于指标卡页,此处输出会校验失败）。' +
    '素材无数字时写清机制/因果/影响,禁止编造具体数值。',
  'content-compare':
    'comparisonItems 左右等量:每项 {text,column:"left"|"right",order,bullet:true};' +
    'keyPoints 与 comparisonItems 文本保持一致。',
  'content-cards':
    'cardItems 每项 {title,body},body 必须非空且为 45-70 字「结论+证据+影响」断言,足以撑满卡片。',
  'content-stats-highlight':
    'metricItems 每项 {kind:"metric",label,value,description?};' +
    'metricValues 长度=要点数;只有素材里真实存在的数字才写 value,否则用 kind:"omission"。',
  'content-value-showcase':
    'showcaseMetrics 每项 {label,value,trend?};value 只用素材中的真实数字。',
  'content-timeline':
    'keyPoints 每项为「阶段名：具体动作与结果」的时间点断言(4-6条)。',
  'content-table':
    'keyPoints 每项为「维度：可验证事实」的表格行断言。',
  'content-no-image':
    'keyPoints 每项 18-32 字「结论+证据/机制」断言(4-6条)。',
  'summary':
    'summaryItems 每项 {text,role:"point"|"action"|"takeaway"},逐项承载结论。',
};

interface EnrichmentTarget {
  index: number;
  slide: SlidePlan;
}

function describeTarget(target: EnrichmentTarget): string {
  const { index, slide } = target;
  const fieldRule = TYPED_FIELD_RULES[slide.pageType] || TYPED_FIELD_RULES['content-no-image'];
  const typed = {
    comparisonItems: slide.comparisonItems,
    metricItems: slide.metricItems,
    cardItems: slide.cardItems,
    metricValues: slide.metricValues,
    advantageIndices: slide.advantageIndices,
    showcaseMetrics: slide.showcaseMetrics,
  };
  const typedJson = JSON.stringify(typed, (_k, v) => (v === undefined ? undefined : v));
  return (
    `### 第 ${index + 1} 页 (pageType=${slide.pageType}, 保持此 pageType 不变)\n` +
    `标题：${slide.title}\n` +
    `原要点：${JSON.stringify(slide.keyPoints)}\n` +
    `当前 typed 字段：${typedJson}\n` +
    `扩写要求：${fieldRule}`
  );
}

/**
 * 构造扩写 system prompt。referenceText 是权威素材，强约束只能基于它扩写。
 */
export function buildEnrichmentPrompt(targets: EnrichmentTarget[], referenceText: string): string {
  const targetDescriptions = targets.map(describeTarget).join('\n\n');
  const material = referenceText.trim()
    ? referenceText.trim()
    : '（未提供额外素材，只能基于每页标题与原要点做合理的机制/影响展开）';

  return [
    '你是演示文稿的内容编辑。任务是把稀疏页的空洞短句扩写成信息密度高的断言，' +
      '让每一页有大量具体、可验证的内容，而不是留白。',
    '',
    '## 铁律',
    '1. 只能基于下方「权威素材」和每页标题/原要点扩写，不得凭空编造数字、事实、案例。',
    '2. 素材里有数字就引用真实数字并说明其含义；素材没有数字时，写清机制/因果/影响，' +
      '禁止编造「提升30%」这类具体数值。',
    '3. 扩写后的每个要点 45-70 字，采用「维度结论：具体证据/机制；带来的影响或后果」三段式，' +
      '用冒号与分号连接（如「海温距平突破阈值：赤道东太平洋连续5个月超0.5℃，信风减弱、暖水东移；' +
      '进而重排全球降雨带，南美西岸暴雨与西太平洋干旱同步发生」）。内容要足够撑满卡片，不要只写一句短语。',
    '4. 严格保持每页给定的 pageType 不变，只补齐该页型要求的字段；不要改标题、不要改主色。',
    '5. 每页要点数量按扩写要求给足，unpaired 的对比要点一律补齐成成对。',
    '',
    '## 权威素材（唯一事实来源）',
    material,
    '',
    '## 待扩写的页',
    targetDescriptions,
    '',
    '## 输出格式',
    '只输出一个 JSON（不要任何解释文字、不要 markdown 代码块），结构如下：',
    '{',
    '  "slides": [',
    '    {',
    '      "index": 0,',
    '      "keyPoints": ["扩写后的要点1", "扩写后的要点2"],',
    '      "comparisonItems": [{"text":"...","column":"left","order":0,"bullet":true}],',
    '      "metricValues": [80, 60],',
    '      "advantageIndices": [0],',
    '      "cardItems": [{"title":"...","body":"..."}],',
    '      "metricItems": [{"kind":"metric","label":"...","value":"..."}],',
    '      "showcaseMetrics": [{"label":"...","value":"..."}],',
    '      "summaryItems": [{"text":"...","role":"point"}]',
    '    }',
    '  ]',
    '}',
    '说明：index 必须与待扩写页的序号一致；只需输出该页型需要的字段，其他字段省略。' +
      'contentId 不用输出，由程序补全。',
  ].join('\n');
}
