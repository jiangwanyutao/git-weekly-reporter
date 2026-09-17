import { Link, useLocation } from 'react-router-dom';
import {
  HouseIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  PlusIcon,
  ArrowsClockwiseIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store';
import { getActiveProvider } from '@/lib/glm';
import { toast } from '@/hooks/use-toast';
import { useTheme, type Theme } from '@/hooks/use-theme';
import { useUpdateDialog } from '@/components/UpdateDialog';
import { useAddProjects } from '@/components/AddProjectsDialog';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const ROUTES = [
  { label: '仪表盘', icon: HouseIcon, href: '/' },
  { label: '历史周报', icon: ClockCounterClockwiseIcon, href: '/history' },
  { label: '系统配置', icon: GearSixIcon, href: '/settings' },
];

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: '浅色', icon: SunIcon },
  { value: 'dark', label: '深色', icon: MoonIcon },
  { value: 'system', label: '跟随系统', icon: MonitorIcon },
];

const navItem =
  'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';
const navActive =
  'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-primary';

export function AppSidebar() {
  const location = useLocation();
  const { settings, reports } = useAppStore();
  const { theme, setTheme } = useTheme();
  const { checkForUpdate, updateDialog } = useUpdateDialog();
  const provider = getActiveProvider(settings);
  const ThemeIcon = THEME_OPTIONS.find((o) => o.value === theme)?.icon ?? MonitorIcon;

  const { addProjects, scanning, addProjectsDialog } = useAddProjects();

  const handleCheckUpdate = () => {
    if (!isTauri) {
      toast({ title: '检查更新', description: 'Web模式下不支持检查更新' });
      return;
    }
    checkForUpdate();
  };

  return (
    <aside className="w-[232px] shrink-0 flex flex-col bg-card border-r border-border px-3 py-3.5">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <img src="/logo.png" alt="AI周报" className="h-[30px] w-[30px] rounded-lg shadow-sm" draggable={false} />
        <div className="leading-tight">
          <div className="text-sm font-semibold">AI周报</div>
          <div className="text-[11px] text-muted-foreground">Git Weekly Reporter</div>
        </div>
      </div>

      <div className="px-2.5 pt-2 pb-1.5 text-[11px] font-medium text-muted-foreground">工作台</div>
      <nav className="flex flex-col gap-0.5">
        {ROUTES.map((r) => (
          <Link key={r.href} to={r.href} className={cn(navItem, location.pathname === r.href && navActive)}>
            <r.icon size={17} />
            <span>{r.label}</span>
            {r.href === '/history' && reports.length > 0 && (
              <span className="ml-auto rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                {reports.length}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="px-2.5 pt-4 pb-1.5 text-[11px] font-medium text-muted-foreground">快捷操作</div>
      <nav className="flex flex-col gap-0.5">
        <button onClick={addProjects} disabled={scanning} className={cn(navItem, scanning && 'opacity-60')}>
          <PlusIcon size={17} />
          <span>添加项目</span>
        </button>
        <button onClick={handleCheckUpdate} className={navItem}>
          <ArrowsClockwiseIcon size={17} />
          <span>检查更新</span>
        </button>
      </nav>

      <div className="mt-auto flex items-center gap-2.5 border-t border-border pt-3 pl-1">
        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {(settings.authorName || '我').slice(0, 1)}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold">{settings.authorName || '未设置作者'}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {provider ? `${provider.name} · ${provider.model}` : '未配置模型'} · v{__APP_VERSION__}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-auto grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="切换主题"
            >
              <ThemeIcon size={17} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[130px]">
            {THEME_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value} onClick={() => setTheme(o.value)} className="cursor-pointer gap-2">
                <o.icon size={15} />
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {updateDialog}
      {addProjectsDialog}
    </aside>
  );
}
