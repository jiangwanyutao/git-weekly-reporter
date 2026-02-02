
import { Link, useLocation } from 'react-router-dom';
import { Home, Settings, FileText, FolderPlus, History, RefreshCcw } from 'lucide-react';
import { useAppStore } from '@/store';
import { open } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import { toast } from '@/hooks/use-toast';
import { getVersion } from '@tauri-apps/api/app';
import { useState, useEffect } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function AppSidebar() {
  const location = useLocation();
  const { addProject } = useAppStore();
  const [version, setVersion] = useState('1.0.0');

  useEffect(() => {
    if (isTauri) {
      getVersion().then(setVersion);
    }
  }, []);

  const routes = [
    {
      label: '仪表盘',
      icon: Home,
      href: '/',
    },
    {
      label: '历史周报',
      icon: History,
      href: '/history',
    },
    {
      label: '系统配置',
      icon: Settings,
      href: '/settings',
    },
  ];

  const handleAddProject = async () => {
    try {
      if (!isTauri) {
        // Web 模式下的 Mock 行为
        const mockPath = `C:\\Mock\\Project\\${Math.floor(Math.random() * 1000)}`;
        addProject(mockPath);
        toast({ title: "Mock项目已添加", description: mockPath });
        return;
      }

      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        addProject(selected);
        toast({ title: "项目已添加", description: selected });
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: "添加失败",
        description: err.message || "无法添加项目",
        variant: "destructive"
      });
    }
  };

  const handleCheckUpdate = async () => {
    if (!isTauri) {
      toast({ title: "检查更新", description: "Web模式下不支持检查更新" });
      return;
    }

    try {
      const update = await check();
      console.log(update,'update')
      if (update) {
        toast({
          title: "发现新版本",
          description: `版本: ${update.version}\n内容: ${update.body || '无更新日志'}`,
          action: (
            <div className="flex flex-col gap-2 mt-2 w-full">
              <button
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3"
                onClick={async () => {
                  try {
                    await update.downloadAndInstall();
                    // Optional: relaunch()
                  } catch (e) {
                    console.error(e);
                    toast({ title: "更新失败", description: "请重试或手动下载", variant: "destructive" });
                  }
                }}
              >
                立即更新
              </button>
            </div>
          ),
          duration: 10000,
        });
      } else {
        toast({ title: "检查更新", description: "当前已是最新版本" });
      }
    } catch (error) {
      console.error(error);
      // 忽略部分已知错误，例如配置未完成导致的错误，给用户更友好的提示
      toast({
        title: "检查更新失败",
        description: "请检查网络或更新配置",
        variant: "destructive"
      });
    }
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <FileText className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">周报助手</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>功能导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {routes.map((route) => (
                <SidebarMenuItem key={route.href}>
                  <SidebarMenuButton asChild isActive={location.pathname === route.href}>
                    <Link to={route.href}>
                      <route.icon />
                      <span>{route.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
           <SidebarGroupLabel>快捷操作</SidebarGroupLabel>
           <SidebarGroupContent>
             <SidebarMenu>
               <SidebarMenuItem>
                <SidebarMenuButton onClick={handleAddProject}>
                  <FolderPlus />
                  <span>添加项目</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={handleCheckUpdate}>
                  <RefreshCcw />
                  <span>检查更新</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
             </SidebarMenu>
           </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>
      <SidebarFooter>
        <div className="p-4 text-xs text-muted-foreground text-center">
          @江晚正愁余 V{version}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
