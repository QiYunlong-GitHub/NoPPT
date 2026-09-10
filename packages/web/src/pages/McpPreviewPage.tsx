import { t } from '@/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, FileWarning, RefreshCw } from 'lucide-react';
/**
 * 只读预览页（M7）：`/mcp-preview/:tenant/:user/:id`
 *
 * - 直接拉取 `/api/mcp-view/:tenant/:user/:id` 得到的**自包含 deck HTML**，用 iframe `srcdoc` 渲染；
 * - `sandbox="allow-scripts"`（不放行 allow-same-origin），与父页面隔离；
 * - 通过 postMessage 与 deck 运行时通信（`noppt:prev` / `noppt:next` / `noppt:go`）；
 * - 全程只读：无保存 / 编辑 / 导出入口，不加载 presentation store，不并入"我的演示"列表。
 */
type LoadState = 'loading' | 'ready' | 'error';
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';
export default function McpPreviewPage() {
  const {
    tenant = '',
    user = '',
    id = '',
  } = useParams<{
    tenant: string;
    user: string;
    id: string;
  }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>('loading');
  const [deckHtml, setDeckHtml] = useState('');
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const viewUrl = useMemo(
    () =>
      `${API_BASE}/mcp-view/${encodeURIComponent(tenant)}/${encodeURIComponent(user)}/${encodeURIComponent(id)}`,
    [tenant, user, id],
  );
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setVisible(false);
    fetch(viewUrl)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((html) => {
        if (cancelled) return;
        if (!html || !html.startsWith('<!DOCTYPE html>')) {
          throw new Error('EMPTY');
        }
        setDeckHtml(html);
        setState('ready');
        // 200ms 淡入
        window.setTimeout(() => !cancelled && setVisible(true), 200);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(t('[McpPreviewPage] 加载失败：'), err);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [viewUrl, reloadKey]);
  // 接收 deck 运行时回传的页码
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | {
            type?: string;
            index?: number;
            total?: number;
          }
        | string;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'noppt:index') return;
      if (typeof data.index === 'number') setIndex(data.index);
      if (typeof data.total === 'number') setTotal(data.total);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const post = useCallback((payload: unknown) => {
    frameRef.current?.contentWindow?.postMessage(payload, '*');
  }, []);
  const goPrev = useCallback(() => post({ type: 'noppt:prev' }), [post]);
  const goNext = useCallback(() => post({ type: 'noppt:next' }), [post]);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] transition-colors dark:bg-[#0F172A] dark:text-[#F1F5F9]">
      {/* 顶部条 */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('返回')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#2563EB] dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="truncate text-[20px] font-semibold leading-tight">
            {t('Hermes 产物预览')}
          </span>
        </div>
        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[12px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          {t('只读 · Hermes 产物')}
        </span>
      </header>

      {/* 主舞台 */}
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 pb-24 pt-14">
        {state === 'loading' && (
          <div className="aspect-video w-[92vw] max-w-[1400px] animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
        )}

        {state === 'error' && (
          <div className="flex aspect-video w-[92vw] max-w-[1400px] flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <FileWarning className="h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="text-[14px] font-medium text-slate-500 dark:text-slate-400">
              {t('产物不存在或无权访问')}
            </p>
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 transition-all hover:-translate-y-0.5 hover:border-[#2563EB] hover:text-[#2563EB] dark:border-slate-700 dark:text-slate-300"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('重试')}
            </button>
          </div>
        )}

        {state === 'ready' && (
          <div
            className={`w-[92vw] max-w-[1400px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5 transition-opacity duration-200 dark:border-slate-800 ${visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <iframe
              ref={frameRef}
              title={t('Hermes 产物预览')}
              srcDoc={deckHtml}
              sandbox="allow-scripts"
              className="block aspect-video w-full border-0"
            />
          </div>
        )}
      </main>

      {/* 翻页控制条 */}
      {state === 'ready' && (
        <footer className="fixed inset-x-0 bottom-0 z-20 flex justify-center pb-5">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/90 px-3 py-2 shadow-lg shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
            <button
              type="button"
              onClick={goPrev}
              disabled={index <= 0}
              aria-label={t('上一页')}
              className="flex h-8 items-center gap-1 rounded-full border border-slate-200 px-4 text-[13px] font-medium text-slate-600 transition-all hover:-translate-y-0.5 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('上一页')}
            </button>
            <span className="min-w-[52px] text-center text-[13px] tabular-nums text-slate-500 dark:text-slate-400">
              {index + 1} / {Math.max(1, total)}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={total > 1 && index >= total - 1}
              aria-label={t('下一页')}
              className="flex h-8 items-center gap-1 rounded-full border border-slate-200 px-4 text-[13px] font-medium text-slate-600 transition-all hover:-translate-y-0.5 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              {t('下一页')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
