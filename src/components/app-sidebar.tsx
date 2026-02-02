import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, History, FolderPlus, RefreshCcw, Sparkles, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/store';
import { open } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function AppSidebar() {
  const location = useLocation();
  const { addProject, projects, reports } = useAppStore();

  const routes = [
    {
      label: 'Dashboard',
      icon: LayoutDashboard,
      href: '/',
      badge: projects.length > 0 ? `${projects.length}` : undefined,
    },
    {
      label: 'History',
      icon: History,
      href: '/history',
      badge: reports.length > 0 ? `${reports.length}` : undefined,
    },
    {
      label: 'Settings',
      icon: Settings,
      href: '/settings',
    },
  ];

  const handleAddProject = async () => {
    try {
      if (!isTauri) {
        const mockPath = `C:\\Mock\\Project\\${Math.floor(Math.random() * 1000)}`;
        addProject(mockPath);
        toast({ title: "Mock project added", description: mockPath });
        return;
      }

      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        addProject(selected);
        toast({ title: "Project added", description: selected });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Failed to add", variant: "destructive" });
    }
  };

  const handleCheckUpdate = async () => {
    if (!isTauri) {
      toast({ title: "Check Update", description: "Not supported in web mode" });
      return;
    }

    try {
      const update = await check();
      if (update) {
        toast({
          title: "New version available",
          description: `Version: ${update.version}`
        });
      } else {
        toast({ title: "Check Update", description: "Already up to date" });
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "Update check failed",
        description: "Please check your network",
        variant: "destructive"
      });
    }
  };

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="p-4">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-semibold text-sm">Weekly Reporter</span>
            <span className="text-[10px] text-muted-foreground">AI-Powered</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {routes.map((route) => {
                const isActive = location.pathname === route.href;
                return (
                  <SidebarMenuItem key={route.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={route.label}
                      className={cn(
                        "h-10 transition-all",
                        isActive && "bg-primary/10 text-primary"
                      )}
                    >
                      <Link to={route.href}>
                        <route.icon className={cn("h-4 w-4", isActive && "text-primary")} />
                        <span className="flex-1">{route.label}</span>
                        {route.badge && (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "h-5 min-w-5 px-1.5 text-[10px] font-medium",
                              isActive && "bg-primary/20 text-primary"
                            )}
                          >
                            {route.badge}
                          </Badge>
                        )}
                        <ChevronRight className={cn(
                          "h-4 w-4 opacity-0 -translate-x-2 transition-all group-data-[collapsible=icon]:hidden",
                          isActive && "opacity-100 translate-x-0"
                        )} />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleAddProject}
                  tooltip="Add Project"
                  className="h-10 text-muted-foreground hover:text-foreground"
                >
                  <FolderPlus className="h-4 w-4" />
                  <span>Add Project</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleCheckUpdate}
                  tooltip="Check Update"
                  className="h-10 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCcw className="h-4 w-4" />
                  <span>Check Update</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-muted/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/50 text-[10px] font-bold text-primary-foreground shrink-0">
                JW
              </div>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                <span className="text-xs font-medium">v1.0.0</span>
                <span className="text-[10px] text-muted-foreground">@jiangwanyutao</span>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="group-data-[collapsible=icon]:block hidden">
            v1.0.0 - @jiangwanyutao
          </TooltipContent>
        </Tooltip>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
