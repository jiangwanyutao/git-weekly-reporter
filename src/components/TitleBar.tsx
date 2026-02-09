import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Sun, Moon, Monitor } from 'lucide-react';
import { useAppStore } from '@/store';
import { useEffect } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const appWindow = getCurrentWindow();

// 导出拖拽处理函数，供其他组件使用
export const handleWindowDrag = (e: React.MouseEvent) => {
  if (e.button === 0) {
    appWindow.startDragging();
  }
};

export const TITLEBAR_HEIGHT = 'h-10'; // 40px

// 应用主题到 document
const applyTheme = (theme: 'light' | 'dark' | 'system') => {
  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
};

export function TitleBar() {
  const { settings, updateSettings } = useAppStore();
  const theme = settings.theme || 'dark';

  // 初始化和监听主题变化
  useEffect(() => {
    applyTheme(theme);

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    updateSettings({ theme: newTheme });
  };

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  const themeIcon = {
    light: <Sun className="h-4 w-4" />,
    dark: <Moon className="h-4 w-4" />,
    system: <Monitor className="h-4 w-4" />,
  };

  return (
    <div
      onMouseDown={handleWindowDrag}
      className={`${TITLEBAR_HEIGHT} flex items-center justify-between bg-background select-none border-b border-border/50`}
    >
      {/* 左侧标题 */}
      <div className="flex items-center gap-2 px-4">
        <span className="font-bold text-base">周报助手</span>
      </div>

      {/* 右侧控制按钮 */}
      <div className="flex h-full items-center" onMouseDown={(e) => e.stopPropagation()}>
        {/* 主题切换 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-full px-3 hover:bg-muted transition-colors flex items-center gap-1.5"
              title="切换主题"
            >
              {themeIcon[theme]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[120px]">
            <DropdownMenuItem onClick={() => handleThemeChange('light')} className="cursor-pointer">
              <Sun className="mr-2 h-4 w-4" />
              浅色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleThemeChange('dark')} className="cursor-pointer">
              <Moon className="mr-2 h-4 w-4" />
              深色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleThemeChange('system')} className="cursor-pointer">
              <Monitor className="mr-2 h-4 w-4" />
              跟随系统
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 窗口控制按钮 */}
        <button
          onClick={handleMinimize}
          className="h-full px-4 hover:bg-muted transition-colors"
          title="最小化"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-4 hover:bg-muted transition-colors"
          title="最大化"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleClose}
          className="h-full px-4 hover:bg-destructive hover:text-destructive-foreground transition-colors"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
