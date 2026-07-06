
import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useAppStore, DEFAULT_PROMPT } from '@/store';
import { testModelConnection } from '@/lib/glm';
import { getProjectBranches, getProjectAuthors } from '@/lib/git';
import { normalizeProxyUrl } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FolderPlus, Trash2, Save, Pencil, MessageSquare, Folder, Info, RefreshCw, Download, Loader2, PlugZap, SlidersHorizontal, ChevronDown, GitBranch, User, Cpu, Plus, Eye, EyeOff, CheckCircle2, Database } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import type { BranchMode, AuthorMode, Project, ModelProvider, ProviderProtocol } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const PROTOCOL_OPTIONS: { value: ProviderProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'minimax', label: 'MiniMax' },
];

// 单个模型提供商卡片：内置(glm/minimax)只可改 Key/模型/地址，自定义可改全部并删除
function ProviderCard({
  provider,
  isActive,
  onSetActive,
  onUpdate,
  onRemove,
}: {
  provider: ModelProvider;
  isActive: boolean;
  onSetActive: () => void;
  onUpdate: (patch: Partial<ModelProvider>) => void;
  onRemove: () => void;
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div
      className={`rounded-lg border p-4 space-y-4 transition-colors ${
        isActive ? 'border-primary ring-1 ring-primary/40 bg-primary/5' : 'bg-card/50 hover:border-foreground/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {provider.builtin ? (
              <Label className="text-sm font-medium">{provider.name}</Label>
            ) : (
              <Input
                value={provider.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className="h-7 w-44 text-sm font-medium"
                placeholder="提供商名称"
              />
            )}
            {isActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-[10px] font-medium px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" /> 使用中
              </span>
            )}
            {provider.builtin && (
              <span className="rounded-full bg-muted text-muted-foreground text-[10px] px-2 py-0.5">内置</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isActive && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSetActive}>
              设为当前
            </Button>
          )}
          {!provider.builtin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive/90"
              onClick={onRemove}
              title="删除该提供商"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {!provider.builtin && (
        <div className="space-y-2">
          <Label>接口协议</Label>
          <Select value={provider.protocol} onValueChange={(v: ProviderProtocol) => onUpdate({ protocol: v })}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROTOCOL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>API Key</Label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={provider.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            className="pr-9"
            placeholder="请输入 API Key"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title={showKey ? '隐藏' : '显示'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>模型名</Label>
          <Input
            value={provider.model}
            onChange={(e) => onUpdate({ model: e.target.value })}
            placeholder="例如: glm-4.7-flash"
          />
        </div>
        <div className="space-y-2">
          <Label>{provider.builtin ? '接口地址 (Base URL)' : '请求地址 (完整 URL)'}</Label>
          <Input
            value={provider.baseUrl}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            placeholder={provider.builtin ? 'https://api.example.com/v1' : 'https://api.example.com/v1/chat/completions'}
            disabled={provider.id === 'glm'}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {provider.builtin
          ? <>将自动拼接 <code>/chat/completions</code> 发起请求。</>
          : <>直接使用你填写的完整地址发起请求，<span className="text-foreground">不会自动拼接</span>任何路径。</>}
      </p>
    </div>
  );
}

// 单个项目的抓取范围配置（分支 / 作者），展开时懒加载分支与作者列表
function ProjectAdvanced({
  project,
  updateProject,
}: {
  project: Project;
  updateProject: (id: string, data: Partial<Project>) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const branchMode: BranchMode = project.branchMode ?? 'all';
  const authorMode: AuthorMode = project.authorMode ?? 'inherit';

  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    setLoading(true);
    Promise.all([getProjectBranches(project.path), getProjectAuthors(project.path)])
      .then(([b, a]) => {
        setBranches(b);
        setAuthors(a);
      })
      .catch((e) => console.warn('加载分支/作者失败', e))
      .finally(() => setLoading(false));
  }, [loaded, project.path]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 pt-1">
      {/* 分支范围 */}
      <div className="space-y-2">
        <Label className="text-xs flex items-center gap-1">
          <GitBranch className="h-3 w-3" /> 分支范围
        </Label>
        <Select
          value={branchMode}
          onValueChange={(value: BranchMode) =>
            updateProject(project.id, {
              branchMode: value,
              branch: value === 'specific' ? project.branch || branches[0] || '' : project.branch,
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分支（推荐，不漏提交）</SelectItem>
            <SelectItem value="current">仅当前分支</SelectItem>
            <SelectItem value="specific">指定分支</SelectItem>
          </SelectContent>
        </Select>
        {branchMode === 'specific' && (
          <Select
            value={project.branch || ''}
            onValueChange={(value) => updateProject(project.id, { branch: value })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={loading ? '加载中…' : '选择分支'} />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 作者范围 */}
      <div className="space-y-2">
        <Label className="text-xs flex items-center gap-1">
          <User className="h-3 w-3" /> 作者范围
        </Label>
        <Select
          value={authorMode}
          onValueChange={(value: AuthorMode) =>
            updateProject(project.id, {
              authorMode: value,
              author: value === 'specific' ? project.author || authors[0] || '' : project.author,
            })
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">继承全局作者筛选</SelectItem>
            <SelectItem value="all">全部作者</SelectItem>
            <SelectItem value="specific">指定作者</SelectItem>
          </SelectContent>
        </Select>
        {authorMode === 'specific' && (
          <Select
            value={project.author || ''}
            onValueChange={(value) => updateProject(project.id, { author: value })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={loading ? '加载中…' : '选择作者'} />
            </SelectTrigger>
            <SelectContent>
              {authors.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

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
  const [testingConnection, setTestingConnection] = useState(false);

  // 当 zustand 持久化状态恢复后，同步 localSettings
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // ---- 模型提供商管理（作用于 localSettings，点保存后落库）----
  const updateProvider = (id: string, patch: Partial<ModelProvider>) =>
    setLocalSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));

  const addProvider = () =>
    setLocalSettings((prev) => {
      const id = crypto.randomUUID();
      return {
        ...prev,
        providers: [
          ...prev.providers,
          { id, name: '自定义模型', protocol: 'openai', apiKey: '', model: '', baseUrl: '', builtin: false },
        ],
        activeProviderId: prev.activeProviderId || id,
      };
    });

  const removeProvider = (id: string) =>
    setLocalSettings((prev) => {
      const providers = prev.providers.filter((p) => p.id !== id);
      const activeProviderId =
        prev.activeProviderId === id ? providers[0]?.id ?? '' : prev.activeProviderId;
      return { ...prev, providers, activeProviderId };
    });

  const setActiveProvider = (id: string) =>
    setLocalSettings((prev) => ({ ...prev, activeProviderId: id }));

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
      const proxy = normalizeProxyUrl(localSettings.updaterProxyUrl);
      const update = await check(proxy ? { proxy } : undefined);
      if (update) {
        setUpdateAvailable(update);
        toast({ title: "发现新版本", description: `v${update.version} 可用` });
      } else {
        toast({ title: "已是最新版本", description: "当前没有发现新更新" });
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: "检查更新失败", description: error?.message || String(error), variant: "destructive" });
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
      toast({ title: "更新失败", description: error?.message || String(error), variant: "destructive" });
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

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const result = await testModelConnection(localSettings);
      toast({
        title: "连接测试成功",
        description: `${result.providerName} ${result.model} 可正常访问`,
      });
    } catch (error: any) {
      toast({
        title: "连接测试失败",
        description: error.message || "请检查模型配置后重试",
        variant: "destructive",
      });
    } finally {
      setTestingConnection(false);
    }
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
        <Button onClick={handleSave} size="lg" title="保存 API 配置、提示词、Notion 等表单设置（项目相关设置已即时生效）">
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
            <Cpu className="h-4 w-4" />
            模型配置
          </TabsTrigger>
          <TabsTrigger
            value="notion"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 flex items-center gap-2"
          >
            <Database className="h-4 w-4" />
            Notion 同步
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
                    <p className="text-xs text-muted-foreground mb-3">
                      项目的添加/删除、别名与抓取设置（分支 / 作者）<span className="text-foreground font-medium">修改即时生效</span>，无需点击右上角保存。
                    </p>
                    <div className="space-y-3">
                      {projects.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          暂无项目，请点击右上角添加
                        </div>
                      ) : (
                        projects.map((project) => {
                          const branchLabel =
                            (project.branchMode ?? 'all') === 'all' ? '全部分支' :
                            (project.branchMode ?? 'all') === 'current' ? '当前分支' :
                            (project.branch || '指定分支');
                          const authorLabel =
                            (project.authorMode ?? 'inherit') === 'inherit' ? '全局作者' :
                            (project.authorMode ?? 'inherit') === 'all' ? '全部作者' :
                            (project.author || '指定作者');
                          return (
                          <Collapsible key={project.id} className="border rounded-lg bg-card/50 group">
                            <div className="flex items-center justify-between p-3 hover:bg-accent hover:text-accent-foreground transition-colors rounded-lg">
                              <div className="min-w-0">
                                <div className="font-medium flex items-center gap-2">
                                  {project.alias || project.name}
                                  {project.alias && <span className="text-xs text-muted-foreground font-normal transition-colors group-hover:text-accent-foreground/80">({project.name})</span>}
                                </div>
                                <div className="text-xs text-muted-foreground group-hover:text-accent-foreground/80 transition-colors truncate">{project.path}</div>
                                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground group-hover:text-accent-foreground/80">
                                  <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{branchLabel}</span>
                                  <span className="flex items-center gap-1"><User className="h-3 w-3" />{authorLabel}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <CollapsibleTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-foreground hover:bg-accent group-hover:text-foreground/80 [&[data-state=open]>svg:last-child]:rotate-180"
                                    title="抓取设置（分支 / 作者）"
                                  >
                                    <SlidersHorizontal className="h-4 w-4" />
                                    <ChevronDown className="h-3 w-3 ml-0.5 transition-transform" />
                                  </Button>
                                </CollapsibleTrigger>
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
                            <CollapsibleContent className="px-3 pb-3 border-t pt-3">
                              <ProjectAdvanced project={project} updateProject={updateProject} />
                            </CollapsibleContent>
                          </Collapsible>
                          );
                        })
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* 全局作者筛选（仪表盘默认作者；可被每项目“作者范围”覆盖）*/}
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="px-0 py-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <User className="h-5 w-5 text-primary" />
                      全局作者筛选
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 py-2 space-y-2">
                    <Label>Git 作者名称</Label>
                    <Input
                      value={localSettings.authorName}
                      onChange={(e) => setLocalSettings((prev) => ({ ...prev, authorName: e.target.value }))}
                      placeholder="例如: Zhang San（留空 = 全部作者）"
                    />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      作为所有项目的默认作者过滤；可在上方各项目的「抓取设置」中单独覆盖。修改后需点击右上角「保存所有配置」生效。
                    </p>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="api" className="h-full m-0 border-none p-0 data-[state=active]:flex flex-col">
            <ScrollArea className="flex-1">
              <div className="pr-4 pb-4">
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="flex flex-row items-center justify-between px-0 py-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Cpu className="h-5 w-5 text-primary" />
                      模型配置
                    </CardTitle>
                    <Button onClick={addProvider} variant="outline" size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      添加提供商
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4 px-0 py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={testingConnection}
                      >
                        {testingConnection ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PlugZap className="mr-2 h-4 w-4" />
                        )}
                        测试当前连接
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        生成周报使用标记「使用中」的提供商。可添加任意 OpenAI 兼容厂商；测试无需先保存，其余修改需点击右上角「保存所有配置」。
                      </p>
                    </div>

                    <div className="space-y-3">
                      {localSettings.providers.map((p) => (
                        <ProviderCard
                          key={p.id}
                          provider={p}
                          isActive={p.id === localSettings.activeProviderId}
                          onSetActive={() => setActiveProvider(p.id)}
                          onUpdate={(patch) => updateProvider(p.id, patch)}
                          onRemove={() => removeProvider(p.id)}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="notion" className="h-full m-0 border-none p-0 data-[state=active]:flex flex-col">
            <ScrollArea className="flex-1">
              <div className="pr-4 pb-4">
                <Card className="border-0 shadow-none bg-transparent">
                  <CardHeader className="px-0 py-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Database className="h-5 w-5 text-primary" />
                      Notion 同步
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-0 py-2">
                    <div className="rounded-lg border p-4 space-y-4 bg-card/50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium">Notion 自动同步</Label>
                          <p className="text-xs text-muted-foreground">
                            生成周报后按同步方式自动写入 Notion
                          </p>
                        </div>
                        <Switch
                          checked={localSettings.notionAutoSync}
                          onCheckedChange={(checked) =>
                            setLocalSettings((prev) => ({ ...prev, notionAutoSync: checked }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Notion 同步方式</Label>
                        <Select
                          value={localSettings.notionSyncMode || 'append'}
                          onValueChange={(value: 'append' | 'subpage') =>
                            setLocalSettings((prev) => ({ ...prev, notionSyncMode: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="append">追加到父页面正文</SelectItem>
                            <SelectItem value="subpage">创建父页面子页面</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          追加模式可直接在当前文档查看；子页面模式适合按周归档管理。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Notion 内容格式</Label>
                        <Select
                          value={localSettings.notionContentMode || 'markdown'}
                          onValueChange={(value: 'markdown' | 'code') =>
                            setLocalSettings((prev) => ({ ...prev, notionContentMode: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="markdown">Markdown 块渲染</SelectItem>
                            <SelectItem value="code">代码块原样保留</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Markdown 块渲染会把标题、列表、引用和代码段转换成 Notion 块；代码块模式保留原始 Markdown 文本。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Notion Integration Token</Label>
                        <Input
                          type="password"
                          value={localSettings.notionApiKey}
                          onChange={(e) => setLocalSettings({ ...localSettings, notionApiKey: e.target.value })}
                          placeholder="ntn_xxx..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>目标父页面 ID 或 URL</Label>
                        <Input
                          value={localSettings.notionParentPageId}
                          onChange={(e) => setLocalSettings({ ...localSettings, notionParentPageId: e.target.value })}
                          placeholder="粘贴 Notion 页面链接或 Page ID"
                        />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          请先在 Notion 中创建 内部集成 Integration，并将目标页面通过 Add connections 授权给该 Integration。
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          修改后请点击页面右上角“保存所有配置”，否则不会生效。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Notion 代理地址（可选）</Label>
                        <Input
                          value={localSettings.notionProxyUrl}
                          onChange={(e) => setLocalSettings({ ...localSettings, notionProxyUrl: e.target.value })}
                          placeholder="例如Clash verge: http://127.0.0.1:7897"
                        />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          如果网络无法直连 Notion，可填写本机代理地址。留空则直连。
                        </p>
                      </div>
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
                  <CardHeader className="px-0 py-2 flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-lg">提示词模板</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLocalSettings({ ...localSettings, promptTemplate: DEFAULT_PROMPT });
                        toast({ title: '已恢复默认提示词', description: '记得点击“保存”后生效' });
                      }}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      恢复默认
                    </Button>
                  </CardHeader>
                  <CardContent className="px-0 py-2">
                    <div className="space-y-2">
                      <Textarea
                        className="min-h-[200px] font-mono text-sm"
                        value={localSettings.promptTemplate}
                        onChange={(e) => setLocalSettings({ ...localSettings, promptTemplate: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        可用变量: <code>{`{{commits}}`}</code> - 将被替换为具体的 Git 提交记录。若周报仍偏“流水账”，可点右上角“恢复默认”应用新版提示词。
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
                      <Label>更新代理地址（可选）</Label>
                      <Input
                        value={localSettings.updaterProxyUrl}
                        onChange={(e) => setLocalSettings((prev) => ({ ...prev, updaterProxyUrl: e.target.value }))}
                        placeholder="例如 Clash: http://127.0.0.1:7897"
                      />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        检查/下载更新通过 GitHub，更新组件<span className="text-foreground">不会自动走系统代理</span>。若直连失败，填写本机代理地址即可（留空则直连）。修改后需点击右上角「保存所有配置」。
                      </p>
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
