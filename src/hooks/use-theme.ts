import { useEffect } from 'react';
import { useAppStore } from '@/store';
import type { AppSettings } from '@/types';

export type Theme = AppSettings['theme'];

const applyTheme = (theme: Theme) => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark));
};

// 把 settings.theme 同步到 <html class="dark">，并跟随系统主题变化。只在 App 根调用一次。
export function useApplyTheme() {
  const theme = useAppStore((s) => s.settings.theme || 'system');
  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => theme === 'system' && applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
}

export function useTheme() {
  const theme = useAppStore((s) => s.settings.theme || 'system');
  const updateSettings = useAppStore((s) => s.updateSettings);
  return { theme, setTheme: (t: Theme) => updateSettings({ theme: t }) };
}
