import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Wand2, Undo2, Redo2 } from 'lucide-react';
import { usePresentationStore } from '@/stores/presentation';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { aiApi } from '@/utils/api';
import { formatBeijingTime } from '@/utils';
import { t } from '@/i18n';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  scope: 'current' | 'global' | 'selection';
  timestamp?: string;
}

const SUGGESTIONS = [
  { label: '把标题改大一点', scope: 'current' as const },
  { label: '换个蓝色主题', scope: 'global' as const },
  { label: '加一张产品图片', scope: 'current' as const },
  { label: '所有页统一字体', scope: 'global' as const },
  { label: '添加数据图表', scope: 'current' as const },
  { label: '优化整体排版', scope: 'global' as const },
];

interface AIChatPanelProps {
  selectedElements?: HTMLElement[];
  hasSelection?: boolean;
}

export default function AIChatPanel({
  selectedElements = [],
  hasSelection = false,
}: AIChatPanelProps) {
  const presentation = usePresentationStore((s) => s.presentation);
  const updateCurrentSlideHtml = usePresentationStore((s) => s.updateCurrentSlideHtml);
  const setPresentation = usePresentationStore((s) => s.setPresentation);
  const saveHistory = usePresentationStore((s) => s.saveHistory);
  const undo = usePresentationStore((s) => s.undo);
  const redo = usePresentationStore((s) => s.redo);
  const canUndo = usePresentationStore((s) => s.canUndo);
  const canRedo = usePresentationStore((s) => s.canRedo);
  const messages = usePresentationStore((s) => s.chatMessages);
  const addChatMessage = usePresentationStore((s) => s.addChatMessage);
  const settings = useSettingsStore();
  const showToast = useUIStore((s) => s.showToast);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scope, setScope] = useState<'current' | 'global' | 'selection'>('current');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content, up to max 5 lines
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 21; // approximate line-height for text-sm
    const paddingTopBottom = 16; // py-2 = 8px * 2
    const maxHeight = lineHeight * 5 + paddingTopBottom; // 5 lines max
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [input]);

  useEffect(() => {
    if (hasSelection && scope === 'current') {
      setScope('selection');
    } else if (!hasSelection && scope === 'selection') {
      setScope('current');
    }
  }, [hasSelection]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !presentation) return;

    const startTime = Date.now();
    const now = formatBeijingTime();
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      scope,
      timestamp: now,
    };
    addChatMessage(userMessage);
    const userInput = input;
    setInput('');
    setIsLoading(true);

    console.log(`\n[${now}] [AIChat] ========== AI编辑指令开始 ==========`);
    console.log(`[${now}] [AIChat] scope=${scope}, 指令长度=${userInput.length} chars`);
    console.log(
      `[${now}] [AIChat] 指令内容: ${userInput.length > 200 ? userInput.substring(0, 200) + '...' : userInput}`,
    );

    try {
      const stageConfigs = settings.getModelConfigsForStages();
      const logSettings = settings.logSettings;
      const presentationId = presentation.id;
      const currentSlide = presentation.slides.find((s) => s.id === presentation.selectedSlideId);
      const currentIndex = presentation.slides.findIndex(
        (s) => s.id === presentation.selectedSlideId,
      );

      console.log(
        `[${now}] [AIChat] 当前页: 第 ${currentIndex + 1}/${presentation.slides.length} 页, slideId=${presentation.selectedSlideId}`,
      );

      if (scope === 'selection' && selectedElements.length > 0 && currentSlide) {
        console.log(`[${now}] [AIChat] 选中元素数: ${selectedElements.length}`);
        const elementHtmls = selectedElements.map((el) => el.outerHTML);
        const elementIds = selectedElements.map((el) => el.getAttribute('data-noppt-id'));
        const modifiedElements: string[] = [];

        for (let i = 0; i < elementHtmls.length; i++) {
          console.log(
            `[${now}] [AIChat] 正在修改元素 ${i + 1}/${elementHtmls.length} (id=${elementIds[i] || 'none'})...`,
          );
          const response = await aiApi.editElement({
            modelConfigs: stageConfigs,
            presentationId,
            elementHtml: elementHtmls[i],
            userRequest: userInput,
            logSettings,
          });
          modifiedElements.push(response.html);
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentSlide.html;

        let replaceCount = 0;
        selectedElements.forEach((oldEl, i) => {
          const newTempDiv = document.createElement('div');
          newTempDiv.innerHTML = modifiedElements[i];
          const newEl = newTempDiv.firstElementChild as HTMLElement | null;
          if (!newEl) return;

          const elId = elementIds[i];
          let targetEl: HTMLElement | null = null;
          if (elId) {
            targetEl = tempDiv.querySelector(`[data-noppt-id="${elId}"]`);
          }
          if (!targetEl) {
            const outerHtml = oldEl.outerHTML;
            const candidates = Array.from(tempDiv.querySelectorAll<HTMLElement>('*'));
            targetEl = candidates.find((c) => c.outerHTML === outerHtml) || null;
          }
          if (targetEl && targetEl.parentNode) {
            targetEl.parentNode.replaceChild(newEl, targetEl);
            replaceCount++;
          } else {
            console.warn(
              `[${now}] [AIChat] 元素 ${i + 1} (id=${elementIds[i] || 'none'}) 未能在DOM中找到匹配目标，跳过替换`,
            );
          }
        });

        console.log(
          `[${now}] [AIChat] 元素替换完成: ${replaceCount}/${selectedElements.length} 成功`,
        );

        if (replaceCount > 0) {
          updateCurrentSlideHtml(tempDiv.innerHTML);
        }

        addChatMessage({
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: t('已更新选中的 {n} 个元素！你可以继续调整，或者撤销/重做。', {
            n: replaceCount,
          }),
          scope: 'selection',
          timestamp: formatBeijingTime(),
        });
      } else if (scope === 'current' && currentSlide) {
        console.log(`[${now}] [AIChat] 修改前HTML长度: ${currentSlide.html.length} chars`);
        const response = await aiApi.editSlide({
          modelConfigs: stageConfigs,
          presentationId,
          currentHtml: currentSlide.html,
          userRequest: userInput,
          primaryColor: (presentation as any).primaryColor || '#2563eb',
          logSettings,
        });
        const newHtml = response.html;
        console.log(`[${formatBeijingTime()}] [AIChat] 修改后HTML长度: ${newHtml.length} chars`);
        updateCurrentSlideHtml(newHtml);

        addChatMessage({
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: t('已更新当前页面！你可以继续调整，或者撤销/重做。'),
          scope: 'current',
          timestamp: formatBeijingTime(),
        });
      } else {
        const htmlPres = {
          title: presentation.title,
          description: presentation.description,
          slides: presentation.slides.map((s) => ({
            title: s.title,
            html: s.html,
            notes: s.notes,
          })),
        };

        console.log(`[${now}] [AIChat] 全局修改前: ${presentation.slides.length} 页`);
        const result = await aiApi.editGlobal({
          modelConfigs: stageConfigs,
          presentationId,
          presentation: htmlPres,
          currentSlideIndex: currentIndex,
          userRequest: userInput,
          logSettings,
        });
        console.log(`[${formatBeijingTime()}] [AIChat] 全局修改后: ${result.slides.length} 页`);

        const updatedSlides = presentation.slides.map((slide, idx) => {
          const resultSlide = result.slides[idx];
          if (resultSlide) {
            return {
              ...slide,
              title: resultSlide.title || slide.title,
              html: resultSlide.html || slide.html,
              notes: resultSlide.notes || slide.notes,
            };
          }
          return slide;
        });

        const validTransitions = ['none', 'fade', 'slide', 'zoom', 'flip'];
        const newTransition = validTransitions.includes(result.transition || '')
          ? (result.transition as 'none' | 'fade' | 'slide' | 'zoom' | 'flip')
          : presentation.transition;

        setPresentation({
          ...presentation,
          title: result.title || presentation.title,
          description: result.description || presentation.description,
          slides: updatedSlides,
          transition: newTransition,
          updatedAt: Date.now(),
        });
        saveHistory();

        addChatMessage({
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: t('已更新整个演示文稿！共 {n} 页。你可以继续调整。', {
            n: result.slides.length,
          }),
          scope: 'global',
          timestamp: formatBeijingTime(),
        });
      }

      const duration = Date.now() - startTime;
      console.log(
        `[${formatBeijingTime()}] [AIChat] ========== AI编辑指令完成 (耗时=${(duration / 1000).toFixed(1)}s) ==========\n`,
      );
      showToast(t('修改成功！'), 'success');
    } catch (e: any) {
      console.error(`[${formatBeijingTime()}] [AIChat] AI编辑失败:`, e);
      showToast(e.message || t('修改失败，请重试'), 'error');
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t('抱歉，修改失败了：{msg}。请检查 API 配置或重试。', {
          msg: e.message || '未知错误',
        }),
        scope,
        timestamp: formatBeijingTime(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestion = (text: string, suggestionScope: 'current' | 'global') => {
    setScope(suggestionScope);
    setInput(text);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('AI 助手')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('自然语言编辑演示')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t('撤销')}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={t('重做')}
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scope toggle */}
      <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => hasSelection && setScope('selection')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              scope === 'selection'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : hasSelection
                  ? 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
            }`}
            disabled={!hasSelection}
          >
            {t('选中元素')}
          </button>
          <button
            onClick={() => setScope('current')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              scope === 'current'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t('当前页')}
          </button>
          <button
            onClick={() => setScope('global')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              scope === 'global'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t('全部页')}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              } flex flex-col`}
            >
              {msg.timestamp && (
                <span
                  className={`text-[10px] text-slate-400 mb-1 px-1 ${
                    msg.role === 'user' ? 'text-right' : 'text-left'
                  }`}
                >
                  {msg.timestamp}
                </span>
              )}
              <div
                className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-sm'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1 mb-1">
                    <Wand2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      {msg.scope === 'selection'
                        ? t('选中元素')
                        : msg.scope === 'current'
                          ? t('当前页')
                          : t('全部页')}
                    </span>
                  </div>
                )}
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 2 && !isLoading && (
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{t('试试这些：')}</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                onClick={() => handleSuggestion(s.label, s.scope)}
                className="px-2.5 py-1 text-xs rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                {s.scope === 'global' && '🌐 '}
                {t(s.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-700">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())
            }
            placeholder={
              scope === 'selection'
                ? t('描述你想怎么修改选中的元素...')
                : scope === 'current'
                  ? t('描述你想怎么修改当前页...')
                  : t('描述你想怎么修改整个演示...')
            }
            disabled={isLoading}
            rows={1}
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-xl text-sm leading-[21px] focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none overflow-y-auto"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
