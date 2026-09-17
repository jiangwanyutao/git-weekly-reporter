import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAppStore, DEFAULT_PROMPT, DEFAULT_TEMPLATE_ID } from '@/store';
import { PromptTemplatePicker } from '@/components/PromptTemplatePicker';
import { useAddProjects } from '@/components/AddProjectsDialog';
import { testModelConnection } from '@/lib/glm';
import { getProjectBranches, getProjectAuthors } from '@/lib/git';
import { cn, projectDot } from '@/lib/utils';
import { DEFAULT_PROXY_URL, activeProxy } from '@/lib/proxy';
import {
  FolderIcon,
  CpuIcon,
  DatabaseIcon,
  ChatTextIcon,
  InfoIcon,
  PlusIcon,
  PencilSimpleIcon,
  TrashIcon,
  SlidersHorizontalIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  PlugsIcon,
  SpinnerIcon,
  GitBranchIcon,
  UserIcon,
  DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { findUpdate, installUpdate, type FoundUpdate } from '@/lib/updater';
import { getVersion } from '@tauri-apps/api/app';
import type { BranchMode, AuthorMode, Project, ModelProvider, ProviderProtocol } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const PROTOCOL_OPTIONS: { value: ProviderProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'minimax', label: 'MiniMax' },
];

type Section = 'projects' | 'api' | 'notion' | 'prompt' | 'about';
const SECTIONS: { id: Section; label: string; icon: typeof FolderIcon }[] = [
  { id: 'projects', label: '项目管理', icon: FolderIcon },
  { id: 'api', label: '模型配置', icon: CpuIcon },
  { id: 'notion', label: 'Notion 同步', icon: DatabaseIcon },
  { id: 'prompt', label: '提示词模板', icon: ChatTextIcon },
  { id: 'about', label: '关于与更新', icon: InfoIcon },
];

// 设置卡片：标题 + 一句说明 + 右侧操作
function SettingsCard({ title, desc, action, children }: { title: string; desc: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[10px] border border-border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b border-border px-[18px] py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="px-[18px] py-4">{children}</div>
    </section>
  );
}

// 表单行：左列 label + 说明，右列控件
function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4 border-b border-border py-3.5 first:pt-0 last:border-0 last:pb-0 xl:grid-cols-[240px_1fr] xl:gap-6">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const iconBtn = 'grid h-[30px] w-[30px] place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

// 单个模型提供商：内置(glm/minimax)只可改 Key/模型/地址，自定义可改全部并删除
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
    <div className={cn('rounded-[7px] border px-3.5 py-3', isActive ? 'border-primary bg-accent/40' : 'border-border')}>
      <div className="flex items-center gap-2">
        {provider.builtin ? (
          <span className="text-[13px] font-semibold">{provider.name}</span>
        ) : (
          <Input
            value={provider.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="h-7 w-44 text-[13px] font-semibold"
            placeholder="提供商名称"
          />
        )}
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
            <CheckIcon size={11} weight="bold" /> 使用中
          </span>
        )}
        {provider.builtin && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">内置</span>}
        <div className="ml-auto flex items-center gap-1">
          {!isActive && (
            <Button variant="outline" size="sm" className="h-7" onClick={onSetActive}>
              设为当前
            </Button>
          )}
          {!provider.builtin && (
            <button type="button" className={cn(iconBtn, 'hover:text-destructive')} onClick={onRemove} title="删除该提供商">
              <TrashIcon size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2">
        {!provider.builtin && (
          <Field label="接口协议">
            <Select value={provider.protocol} onValueChange={(v: ProviderProtocol) => onUpdate({ protocol: v })}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="API Key">
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
              {showKey ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
        </Field>
        <Field label="模型名">
          <Input value={provider.model} onChange={(e) => onUpdate({ model: e.target.value })} placeholder="例如: glm-4.7-flash" />
        </Field>
        <Field
          label={provider.builtin ? '接口地址 (Base URL)' : '请求地址 (完整 URL)'}
          hint={
            provider.builtin ? (
              <>将自动拼接 <code>/chat/completions</code> 发起请求</>
            ) : (
              <>直接使用你填写的完整地址发起请求，<span className="text-foreground">不会自动拼接</span>任何路径</>
            )
          }
        >
          <Input
            value={provider.baseUrl}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            placeholder={provider.builtin ? 'https://api.example.com/v1' : 'https://api.example.com/v1/chat/completions'}
            disabled={provider.id === 'glm'}
          />
        </Field>
      </div>
    </div>
  );
}

// 单个项目的抓取范围配置（分支 / 作者），打开时懒加载分支与作者列表
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
    <div>
      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            <GitBranchIcon size={14} /> 分支范围
          </span>
        }
      >
        <div className="space-y-2">
          <Select
            value={branchMode}
            onValueChange={(value: BranchMode) =>
              updateProject(project.id, {
                branchMode: value,
                branch: value === 'specific' ? project.branch || branches[0] || '' : project.branch,
              })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分支（推荐，不漏提交）</SelectItem>
              <SelectItem value="current">仅当前分支</SelectItem>
              <SelectItem value="specific">指定分支</SelectItem>
            </SelectContent>
          </Select>
          {branchMode === 'specific' && (
            <Select value={project.branch || ''} onValueChange={(value) => updateProject(project.id, { branch: value })}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={loading ? '加载中…' : '选择分支'} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </Field>

      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            <UserIcon size={14} /> 作者范围
          </span>
        }
      >
        <div className="space-y-2">
          <Select
            value={authorMode}
            onValueChange={(value: AuthorMode) =>
              updateProject(project.id, {
                authorMode: value,
                author: value === 'specific' ? project.author || authors[0] || '' : project.author,
              })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">继承全局作者筛选</SelectItem>
              <SelectItem value="all">全部作者</SelectItem>
              <SelectItem value="specific">指定作者</SelectItem>
            </SelectContent>
          </Select>
          {authorMode === 'specific' && (
            <Select value={project.author || ''} onValueChange={(value) => updateProject(project.id, { author: value })}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={loading ? '加载中…' : '选择作者'} />
              </SelectTrigger>
              <SelectContent>
                {authors.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </Field>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, updateSettings, projects, removeProject, updateProject } = useAppStore();
  const [section, setSection] = useState<Section>('projects');
  const [localSettings, setLocalSettings] = useState(settings);
  const [isAliasDialogOpen, setIsAliasDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [fetchProjectId, setFetchProjectId] = useState<string | null>(null);

  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState<FoundUpdate | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // 当 zustand 持久化状态恢复后，同步 localSettings
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const isDirty = JSON.stringify(localSettings) !== JSON.stringify(settings);

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
      const activeProviderId = prev.activeProviderId === id ? providers[0]?.id ?? '' : prev.activeProviderId;
      return { ...prev, providers, activeProviderId };
    });

  const setActiveProvider = (id: string) => setLocalSettings((prev) => ({ ...prev, activeProviderId: id }));

  useEffect(() => {
    if (isTauri) {
      getVersion().then(setVersion);
    }
  }, []);

  const handleCheckUpdate = async () => {
    if (!isTauri) {
      toast({ title: 'Web 模式', description: '请在客户端中检查更新' });
      return;
    }
    setCheckingUpdate(true);
    try {
      // 检测与下载机制和侧栏「检查更新」共用 lib/updater，只是这里用页面上尚未保存的代理设置，方便先试再存
      const found = await findUpdate(localSettings);
      if (found) {
        setUpdateAvailable(found);
        toast({ title: '发现新版本', description: `v${found.update.version} 可用` });
      } else {
        toast({ title: '已是最新版本', description: '当前没有发现新更新' });
      }
    } catch (error: any) {
      console.error(error);
      toast({ title: '检查更新失败', description: error?.message || String(error), variant: 'destructive' });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleUpdate = async () => {
    if (!updateAvailable) return;
    setUpdating(true);
    try {
      await installUpdate(localSettings, updateAvailable);
      toast({ title: '更新完成', description: '请重启应用以生效' });
    } catch (error: any) {
      console.error(error);
      toast({ title: '更新失败', description: error?.message || String(error), variant: 'destructive' });
    } finally {
      setUpdating(false);
    }
  };

  const handleSave = () => {
    updateSettings(localSettings);
    toast({ title: '设置已保存', description: '您的配置已成功更新。' });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const result = await testModelConnection(localSettings);
      toast({ title: '连接测试成功', description: `${result.providerName} ${result.model} 可正常访问` });
    } catch (error: any) {
      toast({ title: '连接测试失败', description: error.message || '请检查模型配置后重试', variant: 'destructive' });
    } finally {
      setTestingConnection(false);
    }
  };

  // 只添加了一个项目时顺手弹出改别名；批量导入不弹
  const { addProjects, scanning, addProjectsDialog } = useAddProjects({
    onSingleAdded: (project) => openAliasDialog(project.id, project.alias || project.name),
  });

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
      toast({ title: '别名已更新', description: '项目别名已保存' });
    }
  };

  const fetchProject = projects.find((p) => p.id === fetchProjectId);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-6 py-5">
      <div className="shrink-0">
        <h1 className="page-title">系统配置</h1>
        <p className="page-subtitle">项目、模型、同步与提示词，改动会即时标记为未保存</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr] gap-5 2xl:grid-cols-[240px_1fr] 2xl:gap-6">
        {/* 左侧二级导航 */}
        <nav className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-md border border-transparent px-3 text-[13px] font-medium transition-colors',
                section === s.id ? 'border-border bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <s.icon size={16} />
              {s.label}
            </button>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-col gap-4 overflow-auto pr-1">
          {section === 'projects' && (
            <>
              <SettingsCard
                title="Git 项目"
                desc="添加、删除、别名与抓取范围即时生效，无需保存"
                action={
                  <Button variant="outline" size="sm" onClick={addProjects} disabled={scanning}>
                    {scanning ? <SpinnerIcon size={14} className="animate-spin" /> : <PlusIcon size={14} />}
                    {scanning ? '扫描中…' : '添加项目'}
                  </Button>
                }
              >
                {projects.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">暂无项目，请点击右上角添加</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {projects.map((project) => {
                      const branchMode = project.branchMode ?? 'all';
                      const authorMode = project.authorMode ?? 'inherit';
                      const branchLabel = branchMode === 'all' ? '全部分支' : branchMode === 'current' ? '当前分支' : project.branch || '指定分支';
                      const authorLabel = authorMode === 'inherit' ? '跟随全局' : authorMode === 'all' ? '全部作者' : project.author || '指定作者';
                      const chip = (isDefault: boolean) =>
                        cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          isDefault ? 'bg-muted text-muted-foreground' : 'bg-accent text-accent-foreground'
                        );
                      return (
                        <div key={project.id} className="flex items-center gap-3 rounded-[7px] border border-border px-3.5 py-3">
                          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', projectDot(project.alias || project.name))} />
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold">
                              {project.alias || project.name}
                              {project.alias && <span className="ml-1.5 font-normal text-muted-foreground">{project.name}</span>}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{project.path}</div>
                          </div>
                          <div className="ml-auto flex shrink-0 gap-1.5">
                            <span className={chip(branchMode === 'all')}>
                              <GitBranchIcon size={11} /> {branchLabel}
                            </span>
                            <span className={chip(authorMode === 'inherit')}>
                              <UserIcon size={11} /> {authorLabel}
                            </span>
                          </div>
                          <div className="flex shrink-0 gap-0.5">
                            <button className={iconBtn} onClick={() => setFetchProjectId(project.id)} title="抓取设置（分支 / 作者）">
                              <SlidersHorizontalIcon size={16} />
                            </button>
                            <button className={iconBtn} onClick={() => openAliasDialog(project.id, project.alias || project.name)} title="修改别名">
                              <PencilSimpleIcon size={16} />
                            </button>
                            <button className={cn(iconBtn, 'hover:text-destructive')} onClick={() => removeProject(project.id)} title="删除项目">
                              <TrashIcon size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SettingsCard>

              <SettingsCard title="全局作者筛选" desc="作为所有项目的默认作者过滤，可在各项目的抓取设置中单独覆盖">
                <Field label="Git 作者名称" hint="与 git log 中的 author 完全匹配，留空 = 全部作者">
                  <Input
                    value={localSettings.authorName}
                    onChange={(e) => setLocalSettings((prev) => ({ ...prev, authorName: e.target.value }))}
                    placeholder="例如: Zhang San"
                  />
                </Field>
              </SettingsCard>
            </>
          )}

          {section === 'api' && (
            <SettingsCard
              title="模型提供商"
              desc="生成周报使用标记「使用中」的提供商，可添加任意 OpenAI 兼容厂商；测试连接无需先保存"
              action={
                <>
                  <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={testingConnection}>
                    {testingConnection ? <SpinnerIcon size={14} className="animate-spin" /> : <PlugsIcon size={14} />}
                    测试当前连接
                  </Button>
                  <Button variant="outline" size="sm" onClick={addProvider}>
                    <PlusIcon size={14} />
                    添加提供商
                  </Button>
                </>
              }
            >
              <div className="flex flex-col gap-2.5">
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
            </SettingsCard>
          )}

          {section === 'notion' && (
            <SettingsCard title="Notion 同步" desc="请先在 Notion 中创建内部集成 Integration，并将目标页面通过 Add connections 授权给该 Integration">
              <Field label="自动同步" hint="生成周报后按同步方式自动写入 Notion">
                <Switch
                  checked={localSettings.notionAutoSync}
                  onCheckedChange={(checked) => setLocalSettings((prev) => ({ ...prev, notionAutoSync: checked }))}
                />
              </Field>
              <Field label="同步方式" hint="追加模式可直接在当前文档查看；子页面模式适合按周归档管理">
                <Select
                  value={localSettings.notionSyncMode || 'append'}
                  onValueChange={(value: 'append' | 'subpage') => setLocalSettings((prev) => ({ ...prev, notionSyncMode: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="append">追加到父页面正文</SelectItem>
                    <SelectItem value="subpage">创建父页面子页面</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="内容格式" hint="Markdown 块渲染会把标题、列表、引用和代码段转换成 Notion 块；代码块模式保留原始 Markdown 文本">
                <Select
                  value={localSettings.notionContentMode || 'markdown'}
                  onValueChange={(value: 'markdown' | 'code') => setLocalSettings((prev) => ({ ...prev, notionContentMode: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="markdown">Markdown 块渲染</SelectItem>
                    <SelectItem value="code">代码块原样保留</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Integration Token">
                <Input
                  type="password"
                  value={localSettings.notionApiKey}
                  onChange={(e) => setLocalSettings({ ...localSettings, notionApiKey: e.target.value })}
                  placeholder="ntn_xxx..."
                />
              </Field>
              <Field label="目标父页面" hint="粘贴 Notion 页面链接或 Page ID">
                <Input
                  value={localSettings.notionParentPageId}
                  onChange={(e) => setLocalSettings({ ...localSettings, notionParentPageId: e.target.value })}
                  placeholder="https://www.notion.so/xxx"
                />
              </Field>
              <Field label="网络代理" hint="与检查更新共用同一个代理开关，连不上 Notion 时打开">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-muted-foreground">
                    {activeProxy(localSettings) ? `已开启：${activeProxy(localSettings)}` : '未开启，按系统网络设置连接'}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setSection('about')}>
                    去设置
                  </Button>
                </div>
              </Field>
            </SettingsCard>
          )}

          {section === 'prompt' && (
            <SettingsCard
              title="提示词模板"
              desc="内置模板随版本更新；也可以新建自己的模板，命名后随时切换"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLocalSettings({ ...localSettings, promptTemplate: DEFAULT_PROMPT, promptTemplateId: DEFAULT_TEMPLATE_ID });
                    toast({ title: '已恢复默认提示词', description: '记得点击「保存配置」后生效' });
                  }}
                >
                  <ArrowsClockwiseIcon size={14} />
                  恢复默认
                </Button>
              }
            >
              <PromptTemplatePicker settings={localSettings} onChange={setLocalSettings} />
            </SettingsCard>
          )}

          {section === 'about' && (
            <>
              <SettingsCard title="关于 AI周报" desc="客户端会从 GitHub Release 检测最新版本">
                <Field label="当前版本" hint={`v${version || '1.0.0'}`}>
                  <div className="flex justify-end">
                    {updateAvailable ? (
                      <Button size="sm" onClick={handleUpdate} disabled={updating}>
                        {updating ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadSimpleIcon size={14} />}
                        {updating ? '更新中...' : `更新到 v${updateAvailable.update.version}`}
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={handleCheckUpdate} disabled={checkingUpdate}>
                        <ArrowsClockwiseIcon size={14} className={checkingUpdate ? 'animate-spin' : ''} />
                        检查更新
                      </Button>
                    )}
                  </div>
                </Field>
              </SettingsCard>
              <SettingsCard
                title="网络代理"
                desc="Notion 同步与检查更新共用。关闭时不单独指定代理，按系统网络设置连接；检查更新或下载失败时，会自动换另一条线路再试一次"
              >
                <Field label="启用代理" hint="开启后 Notion 同步与检查更新优先走下方地址">
                  <Switch
                    checked={localSettings.proxyEnabled}
                    onCheckedChange={(checked) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        proxyEnabled: checked,
                        // 打开时地址为空就填默认地址，关闭时保留已填地址
                        proxyUrl: checked && !prev.proxyUrl.trim() ? DEFAULT_PROXY_URL : prev.proxyUrl,
                      }))
                    }
                  />
                </Field>
                <Field label="代理地址" hint={`Clash Verge 默认 ${DEFAULT_PROXY_URL}`}>
                  <Input
                    value={localSettings.proxyUrl}
                    disabled={!localSettings.proxyEnabled}
                    onChange={(e) => setLocalSettings((prev) => ({ ...prev, proxyUrl: e.target.value }))}
                    placeholder={DEFAULT_PROXY_URL}
                  />
                </Field>
              </SettingsCard>
              <SettingsCard title="更新说明" desc="本项目已配置支持 GitHub Actions 自动构建">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  当仓库推送 v* 标签（如 v1.0.1）时，会自动构建 Release 并发布更新。
                  <br />
                  客户端会自动检测 GitHub Release 中的最新版本。
                </p>
              </SettingsCard>
            </>
          )}

          {isDirty && (
            <div className="sticky bottom-0 mt-auto flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 py-2.5 shadow-md">
              <span className="h-2 w-2 rounded-full bg-warning" />
              <span className="text-[13px] text-muted-foreground">有未保存的更改</span>
              <div className="ml-auto flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setLocalSettings(settings)}>
                  放弃
                </Button>
                <Button size="sm" onClick={handleSave}>
                  保存配置
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {addProjectsDialog}
      <Dialog open={isAliasDialogOpen} onOpenChange={setIsAliasDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑项目别名</DialogTitle>
            <DialogDescription>设置一个易读的别名，这有助于 AI 更准确地识别和总结该项目。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="alias" className="text-right">
                别名
              </Label>
              <Input id="alias" value={aliasInput} onChange={(e) => setAliasInput(e.target.value)} className="col-span-3" placeholder="例如：周报助手前端" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAliasDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveAlias}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(fetchProject)} onOpenChange={(o) => !o && setFetchProjectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>抓取设置</DialogTitle>
            <DialogDescription>{fetchProject?.alias || fetchProject?.name} 的分支与作者范围，修改即时生效。</DialogDescription>
          </DialogHeader>
          {fetchProject && <ProjectAdvanced project={fetchProject} updateProject={updateProject} />}
          <DialogFooter>
            <Button onClick={() => setFetchProjectId(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
