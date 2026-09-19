import type {
  AgentDeps,
} from './deps';

export function sanitizeImagePrompt(_deps: AgentDeps, rawPrompt: string, primaryColor?: string): string {
    if (!rawPrompt) return '';
    let p = rawPrompt;

    // ---- Step 0（最高优先级）：彻底清除「留出X侧文字排版空间」等导致"半边图像"的高危语义 ----
    // 【为什么要"彻底删除"而不是"替换成X侧渐变背景"？
    //   1. 文字根本不在图片上！HTML 布局中 <img> 和文字是并排兄弟节点，图片本身不需要任何"留空"
    //   2. LLM 规划时频繁把左右搞反（content-image-left 页面反而写"主体偏右留出左侧"，完全错位）
    //   3. "X侧保持简洁渐变背景"这种描述仍然会让模型把 X 侧渲染得很空=观感仍是半边图像
    //   4. 所以最佳策略：不论 LLM 写了"主体偏X+留出Y侧"，一律把这整段"构图位置+留空"描述删除，
    //      只保留正向的"构图饱满、全画布填充、严禁大面积纯色空白"的强约束。
    const replaceReserveSpace = (s: string): string => {
      // ---------- 0.1 最宽泛匹配：【画面主体偏X / 居中偏X】+【留出Y侧 ... 文字...空间】整段删除 ----------
      // 匹配从"画面?主体"开始，到"文字/排版/内容...空间/位置/空白/..."结束的整段，
      // 中间允许任何字符（逗号、停顿、LLM 乱写的连接词），一次性吃掉整段偏置+留空描述。
      // （用 [\s\S]{0,80} 限制跨度，避免误伤过长的正常描述）
      let result = s.replace(
        /[，,。、\s]*画面?主体(?:自然)?(?:居中)?(?:偏[上下左右中])?[\s\S]{0,80}?(?:文字|排版|文本|文案|内容|标题|说明|注解|字幕|批注)[^，,。、;；]{0,40}?(?:位置|空间|地方|区域|面积|空白|空位|地盘)[\s,，。、;；]*/gi,
        '，整体构图饱满充实、全画布四角及边缘均有合理图像内容与细腻层次，严禁大面积纯色空白、严禁未渲染纯色区域、严禁半图半空白，',
      );
      // ---------- 0.2 兜底匹配（上面没命中时）：独立出现的"留出/预留/空出 + ... + 文字类 + ... + 空间类"整段删除 ----------
      // 允许顺序颠倒或拆分表达，例如"给左侧留文字位置"、"右侧作为文字排版区域"
      result = result.replace(
        /[，,。、\s]*(?:留[出下给为生]|腾[出下给]|预[留备下]|空[出给下]|让[出给]|给[予]?|把[将]?|作为)[\s\S]{0,60}?(?:文字|排版|文本|文案|内容|标题|说明|注解|字幕|批注)[^，,。、;；]{0,30}?(?:位置|空间|地方|区域|面积|空白|空位|地盘|面积)[\s,，。、;；]*/gi,
        '，整体构图饱满充实，画面四角均有合理图像内容与细腻层次，严禁大面积纯色空白，',
      );
      // ---------- 0.3 反向匹配："X侧/半边/半部分/... + 用/放/作为 + 文字/排版..." （无"留出"字样但语义相同）
      result = result.replace(
        /[，,。、\s]*[上下左右两][侧边方半部分段区域][\s,，。、;；]*(?:用来?|放|作为|充当)[^，,。、;；]{0,30}?(?:文字|排版|文本|文案|内容|标题|说明|注解)[\s,，。、;；]*/gi,
        '，整体构图平衡饱满，严禁大面积纯色空白，全画布填充完整，',
      );
      // ---------- 0.4 英文近似表达留空语义 ----------
      result = result.replace(
        /[,.\s]+(?:leave|save|reserve|keep|make|set\s*aside)\s+(?:some\s+)?(?:space|room|area|region|margin)\s+(?:on\s+the\s+)?(?:left|right|top|bottom|both\s+sides|side)?\s*(?:for\s+)?(?:text|copy|words|content|caption|subtitle|labels|annotations)[\s,.]*/gi,
        '. Full balanced composition. DO NOT LEAVE LARGE SOLID COLOR EMPTY AREAS anywhere. Every canvas corner and edge has imagery with fine texture and detail. ',
      );
      // ---------- 0.5 "留白"关键词（背景图里经常出现）替换成柔和描述，不能写"空/白"字样 ----------
      // 注：这一步放在 Step 0 而不是 Step 3，因为"留白"对图像生成危害远大于普通元信息
      result = result.replace(
        /(画面|整体|中心|区域|画面中心|中心区域|四周|边缘)?[,，\s]*(干净|大面积|适当|合理|适度|足够|较多)?[,，\s]*留白/gi,
        (_m, area: string | undefined, _degree: string | undefined) => {
          const prefix = area ? `${area}柔和渐变过渡带细腻微纹理与层次` : '柔和渐变与细腻微纹理';
          return prefix;
        },
      );
      // 孤立的"留白"二字
      result = result.replace(/\b留白\b/g, '柔和渐变细腻纹理');
      return result;
    };
    p = replaceReserveSpace(p);
    // 两遍扫描，因为相邻组合或嵌套的表达有时需要两次才能吃干净
    p = replaceReserveSpace(p);

    // ---- Step 1：去除「纯标签式」元信息片段 ----
    // 形如： 风格：空与静 / 风格:极简 / 【风格】xxx
    p = p.replace(
      /[（\(\s,，、。;；]*?(?:风格|画风|样式|设计风格)[：:\s】\]]*[^\s,，。、;；]{1,20}/gi,
      ' ',
    );
    // 形如： 比例要求 16:9 / 比例 4:3 / 宽屏比例16:9 / 画面比例 16:9
    p = p.replace(
      /[（\(\s,，、。;；]*?(?:比例|画面比例|构图比例|图片比例|比例要求)[：:\s]*\d+\s*[:：]\s*\d+/gi,
      ' ',
    );
    // 形如： 16:9宽屏构图 / 16:9横屏 / 4:3竖屏 （直接带数字冒号数字+描述 → 删除）
    p = p.replace(
      /\b\d+\s*[:：]\s*\d+(?:\s*[\u4e00-\u9fa5A-Za-z]{0,12}(?:构图|画面|比例|横屏|宽屏|竖屏|尺寸))?/g,
      ' ',
    );
    // 形如： 颜色代码 #0891b2 / 主色调#FFFFFF / 主色: #2563eb / PRIMARY #FFFFFF / 色值 #xxx
    p = p.replace(
      /[（\(\s,，、。;；]*?(?:颜色代码|主色调?|primary(?:\s*color)?|PRIMARY(?:\s*COLOR)?|色值|十六进制|hex|HEX|COLOR|RGB(?:\s*值)?|配色)[：:\s]*#([0-9a-fA-F]{3,8})\b/gi,
      ' ',
    );
    // 形如： 蓝色调(#2563eb) / 青蓝色(#0891b2) - 注意括号内的 hex
    p = p.replace(/\(\s*#([0-9a-fA-F]{3,8})\s*\)/g, ' ');
    // 形如： （#FFFFFF） / 【#2563eb】
    p = p.replace(/[\(\[（【]\s*#([0-9a-fA-F]{3,8})\s*[\)\]）】]/g, ' ');
    // 形如： standalone RGB(...) / rgba(...) 标签（不是在描述性语句里的那种，而是孤立色值）
    p = p.replace(
      /[,，\s]rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[0-9.]+\s*)?\)[\s,，。]*/gi,
      ' ',
    );

    // ---- Step 2：去除孤立、短的纯 hex 颜色代码（但避免误伤像 C4D、B2B 这种正常英文词）----
    // 我们用更保守的规则：只删前后是中文/标点/空白 或行首行尾 场景下的 #HEX，且 HEX 恰好 3、6、8 位
    const hexBoundary = (s: string): string =>
      s.replace(
        /(^|[\u4e00-\u9fa5\s,，。、;；:：\(\)\[\]（）【】"'`])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?=$|[\u4e00-\u9fa5\s,，。、;；:：\(\)\[\]（）【】"'`])/g,
        '$1 ',
      );
    p = hexBoundary(hexBoundary(p)); // 两遍处理（有些相邻需要两轮）

    // ---- Step 3：去除孤立的纯元关键词（2-6字，没有正常画面描述语义）----
    // 【重要】绝对不要把「无文字/NO TEXT/无LOGO/无水印」等要传给图像模型的正向约束删掉！
    // 这些词是图像模型防画文字/水印的关键指令，要保留在 prompt 里强化效果；
    // Step 3 只清理「淡雅背景/高分辨率」这种与画面内容无关、又会稀释权重的元形容词。
    const metaKeywords = [
      '淡雅背景',
      '低饱和度',
      '高质量',
      '专业',
      '高清',
      '超清',
      '4k',
      '8K',
      '4K',
      '高分辨率',
      '像素级',
      '构图',
      '宽屏',
      '横屏',
      '竖屏',
      '留出空间',
      '留空',
      '排版空间',
      '文字空间',
      '文字位置',
      '空白区域',
      '文本区域',
      '文字区',
      '排版区',
      '文字占位',
    ];
    for (const kw of metaKeywords) {
      const regex = new RegExp(
        `(^|[\\s,，。、;；])${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?=$|[\\s,，。、;；])`,
        'gi',
      );
      p = p.replace(regex, '$1 ');
    }

    // ---- Step 4：把 主色/primary color 重写为自然语言色感描述（不写代码）----
    // 返回值：[色系中文描述, 色系英文锚定词] — 英文锚定词用于 Step 7 末尾强约束，防止 prompt_extend 改写时色系漂移（绿→蓝）
    let toneEnAnchor: string | null = null;
    if (primaryColor) {
      const pc = primaryColor.replace('#', '').toLowerCase();
      // 简单色感映射：按 R 分量、G 分量、B 分量判断大致色系
      const r = parseInt(pc.substring(0, 2), 16);
      const g = parseInt(pc.substring(2, 4), 16);
      const b = parseInt(pc.substring(4, 6), 16);
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      let tone = '';
      if (maxC - minC < 30) {
        tone = lum > 0.6 ? '浅灰白色系' : lum > 0.35 ? '中灰色系' : '深灰色系';
        toneEnAnchor = 'NEUTRAL GRAY / MONOCHROME FAMILY ONLY';
      } else if (r === maxC && g > b * 1.5) {
        tone = lum > 0.55 ? '暖橙黄色系' : '温暖红棕色调';
        toneEnAnchor = 'WARM ORANGE-AMBER COLOR PALETTE — DO NOT SWITCH TO BLUE';
      } else if (r === maxC) {
        tone = lum > 0.5 ? '温暖玫粉色系' : '深邃酒红紫色调';
        toneEnAnchor = 'WARM RED-ROSE-PINK / REDDISH VIOLET PALETTE ONLY';
      } else if (g === maxC && r > b) {
        tone = lum > 0.55 ? '清新嫩黄绿色系' : '自然森林深绿色调';
        toneEnAnchor =
          'GREEN FAMILY DOMINANT (lime / yellow-green / forest). DO NOT SWITCH TO BLUE/INDIGO FAMILY';
      } else if (g === maxC) {
        tone = lum > 0.55 ? '清爽青绿色系' : '高级深青碧色调';
        toneEnAnchor =
          'GREEN-EMERALD-TEAL (CYAN-GREEN) FAMILY. KEEP GREEN TONES PROMINENT — DO NOT SHIFT TO PURE BLUE';
      } else if (b === maxC && g > r * 0.8) {
        tone = lum > 0.55 ? '清澈青蓝色系' : '商务海蓝深青色调';
        toneEnAnchor = 'CYAN / TEAL / LIGHT SEA BLUE FAMILY';
      } else {
        tone = lum > 0.55 ? '优雅蓝紫色系' : '沉稳深邃靛蓝紫色调';
        toneEnAnchor = 'INDIGO / VIOLET / ROYAL BLUE PALETTE';
      }
      // 把 prompt 里所有提到主色相关的位置替换成色系描述
      p = p.replace(
        /(整体(?:的|色调|配色|视觉)?|配色(?:方案|整体)?|(?:主色调?|整体色彩|色彩基调|色系统一)[，,\s]*)以?(?:[为是]|统一(?:为|使用)?)?\s*[#＃]?[0-9a-fA-F]{3,8}\b/gi,
        `整体${tone}氛围`,
      );
      // 如果 prompt 里完全没有提到色系（清洗后缺失），则末尾补一句色系描述
      if (
        !/(色系|色调|色彩|颜色|配色|blue|green|red|purple|orange|yellow|pink|gray|grey|cyan|navy|teal|emerald|rose|amber|violet|indigo)/i.test(
          p,
        )
      ) {
        p = p.trim() + `，${tone}统一配色基调`;
      }
    }

    // ---- Step 5：用「宽幅 landscape」替代数字比例（1792x1024 已经是 wide landscape，不需要模型看到「16:9」字符串）----
    // 宽屏/landscape 只保留一个自然词，避免重复
    if (/(16\s*[:：]\s*9|wide|landscape|宽幅|全景|横版)/i.test(p)) {
      // 已经有了就不再重复补（下面统一补 NO TEXT）
    }

    // ---- Step 6：压缩重复空白、重复标点，整理为一行 ----
    p = p
      .replace(/[\s\u3000]+/g, ' ')
      .replace(/[，,]{2}/g, '，')
      .replace(/[。.]{2}/g, '。')
      .replace(/\s*[，,。.]\s*[，,。.]/g, '，')
      .trim();
    if (p.endsWith('，') || p.endsWith(',') || p.endsWith('。')) p = p.slice(0, -1);

    // ---- Step 6.5（新增·中文防文字/防颜色代号强约束）：在英文末尾约束之前，用中文明确禁止画面中出现文字/字母/数字/颜色代码 ----
    // 为什么要补这段？因为 qwen-image 的 prompt_extend 对中文语义理解更强，且中段落权重 > 末尾英文权重。
    // 同时：如果 prompt 本身已经有「无文字 / 无颜色代码」等描述，就不重复补，避免稀释。
    const hasNoTextHint =
      /(无文字|无任何文字|不出现文字|不要文字|严禁文字|禁止文字|纯视觉|纯图像|纯插画|没有文字|NO TEXT|no text|No text)/i.test(
        p,
      );
    const hasNoColorCodeHint =
      /(无颜色代码|无颜色代号|不出现颜色代码|不要颜色代码|严禁颜色代码|禁止颜色代码|NO COLOR CODE|no hex|no rgb)/i.test(
        p,
      );
    if (!hasNoTextHint || !hasNoColorCodeHint) {
      const cnConstraints: string[] = [];
      if (!hasNoTextHint)
        cnConstraints.push(
          '画面中严禁出现任何文字、汉字、字母、数字、符号、标签、标题、Logo、水印，纯视觉插画',
        );
      if (!hasNoColorCodeHint)
        cnConstraints.push('画面中严禁出现任何颜色代码、色值编号、HEX色值、RGB函数、十六进制色号');
      const extra = '，' + cnConstraints.join('，') + '，';
      p = p + extra;
    }

    // ---- Step 7：末尾英文强约束（大幅压缩 + 补充构图/色系负约束）----
    // 改进点：
    //   a. 压缩为 ~80 chars，不冲淡主 prompt 权重
    //   b. 加入 FULL CANVAS / NO LARGE SOLID EMPTY AREAS — 防止半边图像
    //   c. 动态加入 toneEnAnchor（色系锚定）— 防止 prompt_extend 改写后颜色漂移（绿→蓝）
    const canvasConstraint =
      ' FULL CANVAS COVERAGE. NO LARGE SOLID COLOR EMPTY AREAS. NO BLANK REGIONS. All 4 corners filled with imagery.';
    const noTextConstraint =
      ' STRICTLY NO TEXT/LETTERS/NUMBERS/WATERMARKS/LOGOS/LABELS. PURE VISUAL ILLUSTRATION ONLY.';
    const colorAnchor = toneEnAnchor ? ` COLOR ANCHOR: ${toneEnAnchor}.` : '';
    const appendix = ` ${canvasConstraint}${colorAnchor}${noTextConstraint}`;
    if (!p.includes('FULL CANVAS COVERAGE')) {
      // 避免重复附加
      p = p + appendix;
    }
    return p;
  }

