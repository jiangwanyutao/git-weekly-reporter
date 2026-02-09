
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderPlus, Trash2, Save, Pencil, Key, MessageSquare, Folder, Info, RefreshCw, Download } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function SettingsPage() {
  const { settings, updateSettings, projects, addProject, removeProject, updateProject } = useAppStore();
  const [localSettings, setLocalSettings] = useState(settings);
  const [isAliasDialogOpen, setIsAliasDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState("");

  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState<any>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);

  // 当 zustand 持久化状态恢复后，同步 localSettings
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (isTauri) {
      getVersion().then(setVersion);
    }
  }, []);

  const handleCheckUpdate = async () => {
    if (!isTauri) {
      toast({ title: "Web 模式", description: "请在客户端中检查更新" });
      return;
    }
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (update) {
        setUpdateAvailable(update);
        toast({ title: "发现新版本", description: `v${update.version} 可用` });
      } else {
        toast({ title: "已是最新版本", description: "当前没有发现新更新" });
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: "检查更新失败", description: error.message, variant: "destructive" });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleUpdate = async () => {
    if (!updateAvailable) return;
    setUpdating(true);
    try {
      await updateAvailable.downloadAndInstall();
      toast({ title: "更新完成", description: "请重启应用以生效" });
    } catch (error: any) {
      console.error(error);
      toast({ title: "更新失败", description: error.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const handleSave = () => {
    updateSettings(localSettings);
    toast({
      title: "设置已保存",
      description: "您的配置已成功更新。",
    });
  };

  const handleAddProject = async () => {
    try {
      if (!isTauri) {
        // Web 模式下的 Mock 行为
        const mockPath = `C:\\Mock\\Project\\${Math.floor(Math.random() * 1000)}`;
        addProject(mockPath);
        // Mock add logic: find the newly added project (mock) to open dialog
        // In real app we might want addProject to return ID, but here we can just pick the last one or wait
        // For simplicity in mock:
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

        // Find the newly added project to trigger alias editing
        // Since state update is async, we might need a better way, but for now we can rely on store updating
        // However, standard zustand updates are sync.
        const newProject = useAppStore.getState().projects.find(p => p.path === selected);
        if (newProject) {
          openAliasDialog(newProject.id, newProject.alias || newProject.name);
        }
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

  const openAliasDialog = (id: string, currentName: string) => {
    setEditingProjectId(id);
    setAliasInput(currentName);
    setIsAliasDialogOpen(true);
  };

  const handleSaveAlias = () => {
    if (editingProjectId) {
      updateProject(editingProjectId, { alias: aliasInput });
      setIsAliasDialogOpen(false);
      setEditingProjectId(null);
      toast({ title: "别名已更新", description: "项目别名已保存" });
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <h1 className="text-3xl font-bold">系统配置</h1>
        <Button onClick={handleSave} size="lg">
          <Save className="mr-2 h-4 w-4" />
          保存所有配置
        </Button>
      </div>

      <Tabs defaultValue="projects" className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-background gap-6 shrink-0">
          <TabsTrigger
            value="projects"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 flex items-center gap-2"
          >
            <Folder className="h-4 w-4" />
            项目管理
          </TabsTrigger>
          <TabsTrigger
            value="api"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 flex items-center gap-2"
          >
            <Key className="h-4 w-4" />
            API 配置
          </TabsTrigger>
          <TabsTrigger
            value="prompt"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 flex items-center gap-2"
          >
            <MessageSquare className="h-4 w-4" />
            提示词
          </TabsTrigger>
          <TabsTrigger
            value="about"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 flex items-center gap-2"
          >
            <Info className="h-4 w-4" />
            关于与更新
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 mt-2 overflow-auto">
          <TabsContent value="projects" className="h-full m-0 border-none p-0 data-[state=active]:flex flex-col">
            <ScrollArea className="flex-1">
              <div className="pr-4 pb-4">
                {/* 1. Git 项目管理 */}
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="flex flex-row items-center justify-between px-0 py-2">
                    <CardTitle className="text-lg">Git 项目管理</CardTitle>
                    <Button onClick={handleAddProject} variant="outline" size="sm">
                      <FolderPlus className="mr-2 h-4 w-4" />
                      添加项目
                    </Button>
                  </CardHeader>
                  <CardContent className="px-0 py-2">
                    <div className="space-y-3">
                      {projects.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          暂无项目，请点击右上角添加
                        </div>
                      ) : (
                        projects.map((project) => (
                          <div key={project.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors group bg-card/50">
                            <div>
                              <div className="font-medium flex items-center gap-2">
                                {project.alias || project.name}
                                {project.alias && <span className="text-xs text-muted-foreground font-normal transition-colors group-hover:text-accent-foreground/80">({project.name})</span>}
                              </div>
                              <div className="text-xs text-muted-foreground group-hover:text-accent-foreground/80 transition-colors">{project.path}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-foreground hover:bg-accent group-hover:text-foreground/80"
                                onClick={() => openAliasDialog(project.id, project.alias || project.name)}
                                title="修改别名"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive/90 group-hover:bg-destructive/10"
                                onClick={() => removeProject(project.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="api" className="h-full m-0 border-none p-0 data-[state=active]:flex flex-col">
            <ScrollArea className="flex-1">
              <div className="pr-4 pb-4">
                {/* 2. GLM 模型配置 */}
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="px-0 py-2">
                    <CardTitle className="text-lg">模型配置 (GLM-4.7)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-0 py-2">
                    <div className="space-y-2">
                      <Label>API Key</Label>
                      <Input
                        type="password"
                        value={localSettings.glmApiKey}
                        onChange={(e) => setLocalSettings({ ...localSettings, glmApiKey: e.target.value })}
                        placeholder="请输入智谱 AI 的 API Key"
                      />
                      <p className="text-xs text-muted-foreground">
                        申请地址: <a href="https://bigmodel.cn" target="_blank" className="underline">bigmodel.cn</a>
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Git 作者名称 (用于筛选)</Label>
                      <Input
                        value={localSettings.authorName}
                        onChange={(e) => setLocalSettings({ ...localSettings, authorName: e.target.value })}
                        placeholder="例如: Zhang San"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="prompt" className="h-full m-0 border-none p-0 data-[state=active]:flex flex-col">
            <ScrollArea className="flex-1">
              <div className="pr-4 pb-4">
                {/* 3. 提示词配置 */}
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="px-0 py-2">
                    <CardTitle className="text-lg">提示词模板</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 py-2">
                    <div className="space-y-2">
                      <Textarea
                        className="min-h-[200px] font-mono text-sm"
                        value={localSettings.promptTemplate}
                        onChange={(e) => setLocalSettings({ ...localSettings, promptTemplate: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        可用变量: <code>{`{{commits}}`}</code> - 将被替换为具体的 Git 提交记录
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="about" className="h-full m-0 border-none p-0 data-[state=active]:flex flex-col">
            <ScrollArea className="flex-1">
              <div className="pr-4 pb-4">
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="px-0 py-2">
                    <CardTitle className="text-lg">关于 AI 周报助手</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 py-2 space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg bg-card/50">
                      <div>
                        <div className="font-medium">当前版本</div>
                        <div className="text-sm text-muted-foreground">v{version || '1.0.0'}</div>
                      </div>
                      <div className="flex gap-2">
                        {updateAvailable ? (
                          <Button onClick={handleUpdate} disabled={updating}>
                            {updating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            {updating ? '更新中...' : `更新到 v${updateAvailable.version}`}
                          </Button>
                        ) : (
                          <Button variant="outline" onClick={handleCheckUpdate} disabled={checkingUpdate}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
                            检查更新
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3 className="font-medium">更新说明</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        本项目已配置支持 GitHub Actions 自动构建。
                        <br />
                        当仓库推送 v* 标签（如 v1.0.1）时，会自动构建 Release 并发布更新。
                        <br />
                        客户端会自动检测 GitHub Release 中的最新版本。
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>

      <Dialog open={isAliasDialogOpen} onOpenChange={setIsAliasDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑项目别名</DialogTitle>
            <DialogDescription>
              设置一个易读的别名，这有助于 AI 更准确地识别和总结该项目。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="alias" className="text-right">
                别名
              </Label>
              <Input
                id="alias"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                className="col-span-3"
                placeholder="例如：周报助手前端"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAliasDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveAlias}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
