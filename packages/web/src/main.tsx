import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n';
import './index.css';

// 诊断用：把“被吞掉的白屏报错”直接画到页面上（可随时还原）
function renderFatal(error: unknown) {
  const root = document.getElementById('root');
  if (!root) return;
  const raw = error instanceof Error ? error.stack || error.message : String(error);
  const escaped = String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  root.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;padding:16px;color:#b91c1c;background:#fff;font:13px/1.6 monospace;min-height:100vh;margin:0;">${escaped}</pre>`;
}

window.addEventListener('error', (e) => {
  // 资源加载错误（如脚本 404/ MIME 错误）e.message 为空，用 e.target 补充
  const target = e.target as HTMLElement | null;
  if (target && (target as any).src) {
    renderFatal(`Resource failed to load: ${(target as any).src}`);
  } else {
    renderFatal((e as ErrorEvent).error || (e as ErrorEvent).message || 'Unknown error');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  renderFatal(e.reason || 'Unhandled promise rejection');
});

async function bootstrap() {
  try {
    const { default: App } = await import('./App');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <BrowserRouter>
          <I18nProvider>
            <App />
          </I18nProvider>
        </BrowserRouter>
      </React.StrictMode>,
    );
  } catch (err) {
    renderFatal(err);
  }
}

bootstrap();
