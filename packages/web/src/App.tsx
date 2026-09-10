import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import PreviewPage from './pages/PreviewPage';
import McpPreviewPage from './pages/McpPreviewPage';
import SettingsPage from './pages/SettingsPage';
import PresentationsPage from './pages/PresentationsPage';
import Toast from './components/Toast';
import { useSettingsStore } from './stores/settings';

function applyTheme(theme: 'light' | 'dark' | 'auto') {
  const root = document.documentElement;
  
  let isDark = false;
  if (theme === 'dark') {
    isDark = true;
  } else if (theme === 'auto') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function App() {
  const [isReady, setIsReady] = useState(false);
  const theme = useSettingsStore((s) => s.interfaceSettings.theme);

  useEffect(() => {
    useSettingsStore.getState().loadSettings().finally(() => {
      const loadedTheme = useSettingsStore.getState().interfaceSettings.theme;
      applyTheme(loadedTheme);
      setIsReady(true);
    });
  }, []);

  useEffect(() => {
    if (isReady) {
      applyTheme(theme);
    }
  }, [theme, isReady]);

  useEffect(() => {
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('auto');
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/presentations" element={<PresentationsPage />} />
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="/preview/:id" element={<PreviewPage />} />
        <Route path="/mcp-preview/:tenant/:user/:id" element={<McpPreviewPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      <Toast />
    </div>
  );
}

export default App;
