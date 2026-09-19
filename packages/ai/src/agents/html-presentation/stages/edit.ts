import type { AgentDeps } from './deps';
import { formatBeijingTime, formatDuration } from '../../../providers/base';
import { HTML_GLOBAL_MODIFICATION_PROMPT, HTML_SLIDE_MODIFICATION_PROMPT } from '../../../templates/generate-html-presentation';
import { ChatMessage } from '../../../types';
import { switchStage } from './deps';
import { extractHtml, flattenMeaninglessNesting, sanitizeSlideHtml } from '../html-sanitize';
import { parsePresentation, sanitizeGradientColors } from '../palette';
import { HTMLPresentation, darkenColor, extractSlideCount } from '../shared';
import { ensureSemanticWrapping, wrapTextNodes } from '../postprocess';
export async function modifySlide(deps: AgentDeps, currentHtml: string, userRequest: string, primaryColor: string = '#2563eb'): Promise<string> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();
    console.log(`\n[${timestamp}] [AGENT] ========== modifySlide 开始 ==========`);
    console.log(
      `[${timestamp}] [AGENT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 当前HTML长度: ${currentHtml.length} chars, primaryColor: ${primaryColor}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 编辑模型: ${deps.editingProvider.name}/${deps.editingProvider.config.model}`,
    );

    const prompt = HTML_SLIDE_MODIFICATION_PROMPT.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
      .replace(/\{\{TITLE_TEXT_COLOR\}\}/g, '#111827')
      .replace(/\{\{BODY_TEXT_COLOR\}\}/g, '#374151')
      .replace('{{CURRENT_HTML}}', currentHtml)
      .replace('{{USER_REQUEST}}', userRequest)
      .replace('{{SCOPE_NOTE}}', '只修改当前这一页的内容，保持其他页面不变。');
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个专业的前端设计师，严格遵守8pt网格和设计规范。' },
      { role: 'user', content: prompt },
    ];
    switchStage(deps.editingProvider, 'editing');
    const response = await deps.editingProvider.chat(messages, {
      temperature: 0.7,
      maxTokens: 8000,
    });
    let html = extractHtml(response.content);
    const rawLen = html.length;
    html = sanitizeSlideHtml(html);
    html = sanitizeGradientColors(html, primaryColor, darkenColor(primaryColor, 20));
    html = wrapTextNodes(html);
    html = flattenMeaninglessNesting(html);
    html = ensureSemanticWrapping(html);

    const duration = Date.now() - startTime;
    const endTimestamp = formatBeijingTime();
    console.log(
      `[${endTimestamp}] [AGENT] modifySlide 完成: raw=${rawLen} chars → final=${html.length} chars, 耗时=${formatDuration(duration)}, tokens=${response.usage?.totalTokens ?? 'N/A'}`,
    );
    console.log(`[${endTimestamp}] [AGENT] ========== modifySlide 结束 ==========\n`);
    return html;
  }

export async function modifyElement(deps: AgentDeps, elementHtml: string, userRequest: string): Promise<string> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();
    const tagMatch = elementHtml.match(/^<([a-zA-Z0-9]+)/);
    const tagName = tagMatch ? tagMatch[1] : 'unknown';
    console.log(`\n[${timestamp}] [AGENT] ========== modifyElement 开始 ==========`);
    console.log(
      `[${timestamp}] [AGENT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 元素类型: <${tagName}>, HTML长度: ${elementHtml.length} chars`,
    );
    console.log(
      `[${timestamp}] [AGENT] 编辑模型: ${deps.editingProvider.name}/${deps.editingProvider.config.model}`,
    );

    const prompt = `你是一个专业的前端设计师。请根据用户的要求，修改指定的 HTML 元素。

## 要求
1. 只输出修改后的完整 HTML 元素，不要输出其他解释
2. 保持整体设计风格一致
3. 所有样式使用 inline style
4. 保持元素的 position、left、top、width、height 等定位属性不变
5. 只修改用户要求修改的部分
6. 图片必须设置 max-width:100%;max-height:100%;object-fit:contain;
7. 确保修改后的元素大小和位置不变

## 当前元素 HTML
\`\`\`html
{{ELEMENT_HTML}}
\`\`\`

## 用户修改要求
{{USER_REQUEST}}

请输出修改后的完整 HTML 元素：
`
      .replace('{{ELEMENT_HTML}}', elementHtml)
      .replace('{{USER_REQUEST}}', userRequest);
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个专业的前端设计师。' },
      { role: 'user', content: prompt },
    ];
    switchStage(deps.editingProvider, 'editing');
    const response = await deps.editingProvider.chat(messages, {
      temperature: 0.7,
      maxTokens: 4000,
    });
    let html = extractHtml(response.content);
    const rawLen = html.length;
    html = sanitizeSlideHtml(html);
    html = sanitizeGradientColors(html, '#2563eb', '#1e4fbc');

    const duration = Date.now() - startTime;
    const endTimestamp = formatBeijingTime();
    console.log(
      `[${endTimestamp}] [AGENT] modifyElement 完成: raw=${rawLen} chars → final=${html.length} chars, 耗时=${formatDuration(duration)}, tokens=${response.usage?.totalTokens ?? 'N/A'}`,
    );
    console.log(`[${endTimestamp}] [AGENT] ========== modifyElement 结束 ==========\n`);
    return html;
  }

export async function modifyGlobal(deps: AgentDeps, presentation: HTMLPresentation, currentSlideIndex: number, userRequest: string): Promise<HTMLPresentation> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();
    const totalHtmlLen = presentation.slides.reduce((sum, s) => sum + s.html.length, 0);
    console.log(`\n[${timestamp}] [AGENT] ========== modifyGlobal 开始 ==========`);
    console.log(
      `[${timestamp}] [AGENT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 演示文稿: "${presentation.title}", 共 ${presentation.slides.length} 页, 总HTML长度: ${totalHtmlLen} chars`,
    );
    console.log(
      `[${timestamp}] [AGENT] 当前页: 第 ${currentSlideIndex + 1} 页 "${presentation.slides[currentSlideIndex]?.title || ''}"`,
    );
    console.log(
      `[${timestamp}] [AGENT] 编辑模型: ${deps.editingProvider.name}/${deps.editingProvider.config.model}`,
    );

    const currentSlide = presentation.slides[currentSlideIndex];
    const extractedCount = extractSlideCount(userRequest);
    let enhancedRequest = userRequest;
    if (extractedCount) {
      enhancedRequest += `\n\n【重要】幻灯片数量要求：严格只有 ${extractedCount} 页`;
      console.log(`[${timestamp}] [AGENT] 检测到页数要求: ${extractedCount} 页`);
    }
    const primaryColor = presentation.primaryColor || '#2563eb';
    const prompt = HTML_GLOBAL_MODIFICATION_PROMPT.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
      .replace(/\{\{TITLE_TEXT_COLOR\}\}/g, '#111827')
      .replace(/\{\{BODY_TEXT_COLOR\}\}/g, '#374151')
      .replace('{{PRESENTATION_TITLE}}', presentation.title)
      .replace('{{SLIDE_COUNT}}', String(presentation.slides.length))
      .replace('{{CURRENT_SLIDE_INDEX}}', String(currentSlideIndex + 1))
      .replace('{{CURRENT_SLIDE_TITLE}}', currentSlide?.title || '')
      .replace('{{CURRENT_HTML}}', currentSlide?.html || '')
      .replace('{{USER_REQUEST}}', enhancedRequest);
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个专业的演示文稿设计总监，遵循8pt网格和统一设计规范。' },
      { role: 'user', content: prompt },
    ];
    switchStage(deps.editingProvider, 'editing');
    const response = await deps.editingProvider.chat(messages, {
      temperature: 0.7,
      maxTokens: 16000,
    });
    const result = parsePresentation(response.content, primaryColor);

    const duration = Date.now() - startTime;
    const endTimestamp = formatBeijingTime();
    const resultHtmlLen = result.slides.reduce((sum, s) => sum + s.html.length, 0);
    console.log(
      `[${endTimestamp}] [AGENT] modifyGlobal 完成: 返回 ${result.slides.length} 页, 总HTML长度: ${resultHtmlLen} chars, 耗时=${formatDuration(duration)}, tokens=${response.usage?.totalTokens ?? 'N/A'}`,
    );
    if (result.slides.length !== presentation.slides.length) {
      console.log(
        `[${endTimestamp}] [AGENT] 页数变化: ${presentation.slides.length} → ${result.slides.length}`,
      );
    }
    console.log(`[${endTimestamp}] [AGENT] ========== modifyGlobal 结束 ==========\n`);
    return result;
  }
