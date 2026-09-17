import { getCurrentWindow } from '@tauri-apps/api/window';
import { MinusIcon, SquareIcon, XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
// macOS 用系统原生边框和红黄绿按钮（见 src-tauri/tauri.macos.conf.json），四角是系统圆角；
// 这里不再画自己的窗口按钮，只给红黄绿按钮让出左侧位置
const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

export const handleWindowDrag = (e: React.MouseEvent) => {
  if (e.button !== 0 || !isTauri) return;
  void getCurrentWindow().startDragging();
};

const winButton = 'h-full w-[46px] grid place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

export function TitleBar() {
  const win = () => getCurrentWindow();
  return (
    <div
      onMouseDown={handleWindowDrag}
      className={cn(
        'h-10 shrink-0 flex items-center gap-2 pl-4 bg-card border-b border-border select-none text-xs text-muted-foreground',
        isMac && 'pl-[84px]'
      )}
    >
      <img src="/logo.png" alt="" className="h-[18px] w-[18px] rounded-[5px]" draggable={false} />
      <span>AI周报</span>
      {isTauri && !isMac && (
        <div className="ml-auto flex h-full items-center" onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => void win().minimize()} className={winButton} title="最小化">
            <MinusIcon size={14} />
          </button>
          <button onClick={() => void win().toggleMaximize()} className={winButton} title="最大化">
            <SquareIcon size={12} />
          </button>
          <button
            onClick={() => void win().close()}
            className={`${winButton} hover:bg-destructive hover:text-destructive-foreground`}
            title="关闭"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
