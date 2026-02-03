import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

const appWindow = getCurrentWindow();

// 导出拖拽处理函数，供其他组件使用
export const handleWindowDrag = (e: React.MouseEvent) => {
  if (e.button === 0) {
    appWindow.startDragging();
  }
};

export const TITLEBAR_HEIGHT = 'h-10'; // 40px

export function TitleBar() {
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div
      onMouseDown={handleWindowDrag}
      className={`${TITLEBAR_HEIGHT} flex items-center justify-between bg-background select-none`}
    >
      {/* 左侧标题 */}
      <div className="flex items-center gap-2 px-4">
        <span className="font-bold text-base">周报助手</span>
      </div>

      {/* 右侧窗口控制按钮 */}
      <div className="flex h-full" onMouseDown={(e) => e.stopPropagation()}>
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
