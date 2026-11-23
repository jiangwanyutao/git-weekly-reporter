import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { createProvider, PROVIDER_PRESETS, PROVIDER_PROTOCOLS, validateProvider } from '@/lib/provider-config';
import { importProviderConfigs } from '@/lib/provider-import';
import { fetchProviderModels } from '@/lib/provider-models';
import { buildEndpoint } from '@/lib/provider-protocol';
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
  CaretDownIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useState, useEffect, useRef } from 'react';
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

type ProviderTestResult = { configKey: string; success: boolean; message: string };
const providerTestKey = (provider: ModelProvider, proxyUrl?: string) => JSON.stringify([provider, proxyUrl]);

function safeProviderMessage(message: string, provider: ModelProvider, proxyUrl?: string): string {
  const secrets = [provider.apiKey.trim()];
  for (const address of [provider.baseUrl, proxyUrl]) {
    try {
      const url = new URL(address || '');
      secrets.push(url.username, url.password, ...url.searchParams.values());
    } catch { /* 不完整的地址没有可解析的认证或查询参数。 */ }
  }
  let safe = message.replace(/https?:\/\/[^\s<>"']+/gi, (address) => {
    try { const url = new URL(address); return `${url.origin}${url.pathname}${url.search ? '?[已隐藏]' : ''}`; }
    catch { return '[地址已隐藏]'; }
  });
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join('[已隐藏]').split(encodeURIComponent(secret)).join('[已隐藏]');
  }
  return safe;
}

// 单个模型提供商：配置草稿与连接测试共用同一份状态。
function ProviderCard({
  provider,
  isActive,
  onSetActive,
  onUpdate,
  onRemove,
  onTest,
  testing,
  testDisabled,
  proxyUrl,
  testResult,
  expanded,
  onExpandedChange,
  errorFocus,
  onErrorFocused,
}: {
  provider: ModelProvider;
  isActive: boolean;
  onSetActive: () => void;
  onUpdate: (patch: Partial<ModelProvider>) => void;
  onRemove: () => void;
  onTest: () => void;
  testing: boolean;
  testDisabled: boolean;
  proxyUrl?: string;
  testResult?: ProviderTestResult;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  errorFocus?: number;
  onErrorFocused: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const providerPanel = useRef<HTMLDivElement>(null);
  const fieldId = (field: string) => `provider-${provider.id}-${field}`;
  const protocolLabel = PROVIDER_PROTOCOLS.find((item) => item.value === provider.protocol)?.label;
  const visibleTestResult = testResult?.configKey === providerTestKey(provider, proxyUrl) ? testResult : undefined;
  const endpointMode = provider.endpointMode ?? (provider.builtin ? 'base' : 'full');
  const modelConfigKey = JSON.stringify([
    provider.baseUrl, provider.protocol, endpointMode, provider.authMode,
    provider.apiKey, provider.customHeaders, provider.customBody, proxyUrl,
  ]);
  const latestModelConfig = useRef(modelConfigKey);
  latestModelConfig.current = modelConfigKey;
  const modelRequest = useRef<AbortController | null>(null);
  const [modelResult, setModelResult] = useState<{
    configKey: string; loading: boolean; models: { id: string; name: string }[]; error: string;
  } | null>(null);
  const currentModels = modelResult?.configKey === modelConfigKey ? modelResult : null;

  useEffect(() => {
    setModelResult(null);
    return () => {
      modelRequest.current?.abort();
      modelRequest.current = null;
    };
  }, [modelConfigKey]);

  const handleFetchModels = async () => {
    modelRequest.current?.abort();
    const controller = new AbortController();
    modelRequest.current = controller;
    setModelResult({ configKey: modelConfigKey, loading: true, models: [], error: '' });
    const isCurrent = () => !controller.signal.aborted
      && modelRequest.current === controller && latestModelConfig.current === modelConfigKey;
    try {
      const models = await fetchProviderModels(provider, controller.signal, proxyUrl);
      if (isCurrent()) setModelResult({ configKey: modelConfigKey, loading: false, models, error: '' });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : '拉取模型失败，请检查地址与认证配置';
      const safeMessage = safeProviderMessage(message, provider, proxyUrl);
      setModelResult({ configKey: modelConfigKey, loading: false, models: [], error: safeMessage });
    }
  };
  const endpointSuffix = provider.protocol === 'responses' ? '/responses'
    : provider.protocol === 'anthropic' ? '/messages'
    : provider.protocol === 'gemini' ? '/models/{模型名}:generateContent（流式使用 streamGenerateContent）'
    : '/chat/completions';
  let configError = '';
  try { validateProvider(provider, false); } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  let requestAddress = '';
  if (provider.baseUrl.trim() && !(provider.protocol === 'gemini' && endpointMode === 'base' && !provider.model.trim())) {
    try {
      const url = new URL(buildEndpoint(provider));
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash) {
        requestAddress = `${url.origin}${url.pathname}`;
      }
    } catch { /* 填写中的地址不显示为可请求地址。 */ }
  }

  // 保存失败后先展开控件，再定位错误；只响应新的保存尝试，不打断后续编辑。
  useEffect(() => {
    if (!errorFocus) return;
    setAdvancedOpen(true);
    let focusFrame = 0;
    const renderFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        const field = configError.includes('请求头') ? 'headers'
          : /请求体|额外.*参数/.test(configError) ? 'body'
            : configError.includes('协议') ? 'protocol'
              : /认证|鉴权/.test(configError) ? 'auth'
                : /API Key/i.test(configError) ? 'key' : 'url';
        const target = document.getElementById(fieldId(field)) ?? providerPanel.current;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'center' });
        onErrorFocused();
      });
    });
    return () => { cancelAnimationFrame(renderFrame); cancelAnimationFrame(focusFrame); };
  }, [errorFocus]);

  return (
    <Collapsible ref={providerPanel} tabIndex={-1} open={expanded} onOpenChange={onExpandedChange} className={cn(
      'rounded-lg border bg-card transition-colors',
      isActive ? 'border-primary/50' : 'border-border',
    )}>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-lg px-4 py-3', isActive && 'bg-accent/30', !expanded && 'rounded-b-lg')}>
        <CollapsibleTrigger asChild>
          <button type="button" className="group flex min-w-0 flex-1 basis-48 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={`${expanded ? '收起' : '编辑'} ${provider.name || '未命名提供商'} 配置`}>
            <CaretDownIcon size={16} className={cn('shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !expanded && '-rotate-90')} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-all text-sm font-semibold group-hover:text-primary">{provider.name || '未命名提供商'}</span>
                {isActive && <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-foreground"><CheckIcon size={12} weight="bold" />当前使用</span>}
                {provider.builtin && <span className="text-xs text-muted-foreground">内置</span>}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground" title={provider.model || undefined}>
                {provider.model || '尚未选择模型'} · {protocolLabel}
              </span>
            </span>
          </button>
        </CollapsibleTrigger>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!isActive && <Button variant="ghost" size="sm" onClick={onSetActive}>设为当前</Button>}
          <Button variant="outline" size="sm" onClick={onTest} disabled={testDisabled} aria-label={`测试 ${provider.name || '未命名提供商'} 的连接`}>
            {testing ? <SpinnerIcon size={14} className="animate-spin" /> : <PlugsIcon size={14} />}
            {testing ? '测试中…' : '测试连接'}
          </Button>
        </div>
      </div>

      <CollapsibleContent className="border-t border-border">
        <div className="space-y-5 px-4 py-5">
          {!provider.builtin && (
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor={fieldId('name')}>提供商名称</Label>
                <Input id={fieldId('name')} value={provider.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="例如：火山方舟" />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor={fieldId('protocol')}>接口协议</Label>
                <Select value={provider.protocol} onValueChange={(v: ProviderProtocol) => onUpdate({ protocol: v })}>
                  <SelectTrigger id={fieldId('protocol')} aria-label="接口协议" className="[&>span]:truncate"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDER_PROTOCOLS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={fieldId('url')}>{endpointMode === 'base' ? '接口地址 (Base URL)' : '请求地址 (完整 URL)'}</Label>
              <Select value={endpointMode} onValueChange={(value: 'base' | 'full') => onUpdate({ endpointMode: value })}>
                <SelectTrigger aria-label="地址模式" className="h-8 w-auto min-w-40 gap-3 text-xs shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="base">基础地址 · 自动拼接</SelectItem>
                  <SelectItem value="full">完整请求地址</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input id={fieldId('url')} value={provider.baseUrl} aria-label="接口地址" onChange={(e) => onUpdate({ baseUrl: e.target.value })} placeholder={endpointMode === 'base' ? 'https://api.example.com/v1' : 'https://api.example.com/v1/chat/completions'} spellCheck={false} />
            <p className="break-words text-xs leading-relaxed text-muted-foreground">
              {endpointMode === 'base' ? <>自动拼接 <code className="break-all">{endpointSuffix}</code>。</> : '直接使用完整地址，不会自动拼接接口路径。'}
            </p>
            {/^https:\/\/opencode\.ai\/zen\/go\/?(?:[?#]|$)/i.test(provider.baseUrl.trim()) && <p className="text-xs text-muted-foreground">OpenCode Go 的订阅页面地址会自动转换为 API 地址。</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor={fieldId('key')}>API Key{provider.authMode === 'none' && <span className="ml-2 text-xs font-normal text-muted-foreground">当前无需认证</span>}</Label>
            <div className="relative">
              <Input id={fieldId('key')} type={showKey ? 'text' : 'password'} value={provider.apiKey} onChange={(e) => onUpdate({ apiKey: e.target.value })} className="pr-11" placeholder="请输入 API Key" autoComplete="off" spellCheck={false} />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowKey((s) => !s)} className="absolute right-0.5 top-0.5 text-muted-foreground" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} aria-pressed={showKey}>
                {showKey ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={fieldId('model')}>模型名</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id={fieldId('model')} className="min-w-0 flex-1 basis-40" value={provider.model} onChange={(e) => onUpdate({ model: e.target.value })} placeholder="填写模型 ID，或从列表选择" spellCheck={false} />
              <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={handleFetchModels} disabled={currentModels?.loading}>
                {currentModels?.loading ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadSimpleIcon size={14} />}
                {currentModels?.loading ? '拉取中…' : '拉取模型'}
              </Button>
            </div>
            {!!currentModels?.models.length && (
              <Select value={currentModels.models.some((model) => model.id === provider.model) ? provider.model : ''} onValueChange={(model) => onUpdate({ model })}>
                <SelectTrigger aria-label="选择已拉取的模型" className="[&>span]:truncate"><SelectValue placeholder={`选择模型（${currentModels.models.length} 个）`} /></SelectTrigger>
                <SelectContent>{currentModels.models.map((model) => <SelectItem key={model.id} value={model.id} className="break-all">{model.name === model.id ? model.id : `${model.name} (${model.id})`}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {currentModels?.error ? <p role="alert" className="break-words text-xs leading-relaxed text-destructive">{currentModels.error}</p>
              : <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                {currentModels?.loading ? '正在获取供应商的模型列表…' : currentModels && !currentModels.models.length ? '供应商未返回可用模型，请手动填写模型 ID。' : currentModels?.models.length ? `已获取 ${currentModels.models.length} 个模型，也可手动填写其他模型 ID。` : '填写地址与认证后即可拉取；不支持模型列表的供应商可手动填写。'}
              </p>}
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t border-border pt-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="group -ml-2 gap-2 text-muted-foreground">
                <SlidersHorizontalIcon size={14} />高级配置
                <span className="hidden font-normal sm:inline">· 认证、请求头与请求体</span>
                <CaretDownIcon size={14} className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor={fieldId('auth')}>认证方式</Label>
                <Select value={provider.authMode ?? 'auto'} onValueChange={(authMode: 'auto' | 'bearer' | 'api-key' | 'none') => onUpdate({ authMode })}>
                  <SelectTrigger id={fieldId('auth')} aria-label="认证方式"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动（按协议）</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="api-key">API Key 请求头</SelectItem>
                    <SelectItem value="none">不认证</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">默认按协议设置请求头；无需密钥的服务可选不认证。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={fieldId('headers')}>自定义请求头 JSON</Label>
                <Textarea id={fieldId('headers')} value={provider.customHeaders ?? ''} onChange={(e) => onUpdate({ customHeaders: e.target.value })} placeholder={'{"x-api-key":"{{apiKey}}"}'} className="min-h-24 font-mono text-xs" spellCheck={false} />
                <p className="break-words text-xs leading-relaxed text-muted-foreground">{'值可使用 {{apiKey}} 和 {{sessionId}} 占位符，发送时自动替换。'}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={fieldId('body')}>额外请求体 JSON</Label>
                <Textarea id={fieldId('body')} value={provider.customBody ?? ''} onChange={(e) => onUpdate({ customBody: e.target.value })} placeholder={'{"temperature":0.7,"max_tokens":null}'} className="min-h-24 font-mono text-xs" spellCheck={false} />
                <p className="break-words text-xs leading-relaxed text-muted-foreground">null 可移除默认可选参数；不能覆盖 model、messages、input、contents 或 stream。</p>
              </div>
              <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                <p>实际测试请求（查询参数已隐藏）</p>
                <code className="block select-text break-all">{requestAddress ? `POST ${requestAddress}` : '填写有效地址后显示；Gemini 基础地址还需填写模型名。'}</code>
              </div>
            </CollapsibleContent>
          </Collapsible>
          {configError && <p role="alert" className="flex items-start gap-2 break-words text-xs leading-relaxed text-destructive"><WarningCircleIcon size={16} className="shrink-0" />{configError}</p>}
          {!provider.builtin && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={onRemove} aria-label={`删除 ${provider.name || '未命名提供商'}`}><TrashIcon size={14} />删除提供商</Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
      {visibleTestResult && (
        <div className={cn('flex items-start gap-2 rounded-b-lg border-t border-border px-4 py-3', visibleTestResult.success ? 'bg-success/5' : 'bg-destructive/5')} role={visibleTestResult.success ? 'status' : 'alert'}>
          {visibleTestResult.success ? <CheckCircleIcon size={18} className="mt-0.5 shrink-0 text-success" /> : <WarningCircleIcon size={18} className="mt-0.5 shrink-0 text-destructive" />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">{visibleTestResult.success ? '连接测试成功' : '连接测试失败'}</p>
            <Textarea aria-label="连接测试结果（可全选复制）" readOnly value={visibleTestResult.message} rows={visibleTestResult.success ? 2 : 3} className="mt-1 min-h-0 select-text resize-y border-transparent bg-transparent px-1 py-0 text-xs leading-relaxed text-muted-foreground shadow-none md:text-xs" />
          </div>
        </div>
      )}
    </Collapsible>
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
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, ProviderTestResult>>({});
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(settings.activeProviderId || settings.providers[0]?.id || null);
  const [providerErrorFocus, setProviderErrorFocus] = useState<{ id: string; attempt: number } | null>(null);
  const [providerPreset, setProviderPreset] = useState('custom');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  // 当 zustand 持久化状态恢复后，同步 localSettings
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const isDirty = JSON.stringify(localSettings) !== JSON.stringify(settings);

  useEffect(() => {
    if (expandedProviderId && !localSettings.providers.some((provider) => provider.id === expandedProviderId)) {
      setExpandedProviderId(localSettings.activeProviderId || localSettings.providers[0]?.id || null);
    }
  }, [expandedProviderId, localSettings.providers, localSettings.activeProviderId]);

  // 保存条显示期间给 <html> 打标记，右下角提示框据此抬到保存条上方（见 ui/toast.tsx），离开页面时清掉
  useEffect(() => {
    document.documentElement.toggleAttribute('data-savebar', isDirty);
    return () => document.documentElement.removeAttribute('data-savebar');
  }, [isDirty]);

  // ---- 模型提供商管理（作用于 localSettings，点保存后落库）----
  const updateProvider = (id: string, patch: Partial<ModelProvider>) =>
    setLocalSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));

  const addProvider = () => {
    const provider = createProvider(providerPreset);
    setExpandedProviderId(provider.id);
    setLocalSettings((prev) => {
      return {
        ...prev,
        providers: [...prev.providers, provider],
        activeProviderId: prev.activeProviderId || provider.id,
      };
    });
  };

  const removeProvider = (id: string) =>
    setLocalSettings((prev) => {
      const providers = prev.providers.filter((p) => p.id !== id);
      const activeProviderId = prev.activeProviderId === id ? providers[0]?.id ?? '' : prev.activeProviderId;
      return { ...prev, providers, activeProviderId };
    });

  const setActiveProvider = (id: string) => {
    setExpandedProviderId(id);
    setLocalSettings((prev) => ({ ...prev, activeProviderId: id }));
  };

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
    for (const provider of localSettings.providers) {
      try { validateProvider(provider, false); } catch (error) {
        setSection('api');
        setExpandedProviderId(provider.id);
        setProviderErrorFocus((prev) => ({ id: provider.id, attempt: (prev?.attempt ?? 0) + 1 }));
        toast({ title: `${provider.name || '未命名提供商'} 配置有误`, description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
        return;
      }
    }
    updateSettings(localSettings);
    toast({ title: '设置已保存', description: '您的配置已成功更新。' });
  };

  const handleTestConnection = async (providerId = localSettings.activeProviderId) => {
    const provider = localSettings.providers.find((item) => item.id === providerId);
    if (!provider) return;
    const proxyUrl = activeProxy(localSettings);
    const configKey = providerTestKey(provider, proxyUrl);
    setProviderTestResults((prev) => { const next = { ...prev }; delete next[providerId]; return next; });
    setTestingProviderId(providerId);
    try {
      const result = await testModelConnection({ ...localSettings, activeProviderId: providerId });
      const message = safeProviderMessage(`${result.providerName} ${result.model} 可正常访问`, provider, proxyUrl);
      setProviderTestResults((prev) => ({ ...prev, [providerId]: { configKey, success: true, message } }));
      toast({ title: '连接测试成功', description: message });
    } catch (error) {
      const message = safeProviderMessage(error instanceof Error ? error.message : String(error), provider, proxyUrl);
      setProviderTestResults((prev) => ({ ...prev, [providerId]: { configKey, success: false, message } }));
      toast({ title: '连接测试失败', description: message, variant: 'destructive' });
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleImport = () => {
    try {
      const providers = importProviderConfigs(importText);
      setExpandedProviderId(providers[0].id);
      setLocalSettings((prev) => ({ ...prev, providers: [...prev.providers, ...providers], activeProviderId: providers[0].id }));
      setImportText('');
      setImportError('');
      setImportOpen(false);
      toast({ title: `已导入 ${providers.length} 个提供商`, description: '首个导入提供商已设为当前，请测试连接后保存配置。' });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
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
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 py-5 lg:px-6">
      <div className="shrink-0">
        <h1 className="page-title">系统配置</h1>
        <p className="page-subtitle">项目、模型、同步与提示词，改动会即时标记为未保存</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[160px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5 2xl:grid-cols-[200px_minmax(0,1fr)] 2xl:gap-6">
        {/* 左侧二级导航 */}
        <nav aria-label="设置分类" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md border border-transparent px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
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
            <section aria-labelledby="providers-heading" className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="providers-heading" className="text-base font-semibold">模型提供商</h2>
                  <span className="text-xs text-muted-foreground">{localSettings.providers.length} 个配置</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">选择当前模型用于生成周报。测试连接直接使用未保存的配置。</p>
              </div>

              <div className="space-y-3 border-y border-border py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={providerPreset} onValueChange={setProviderPreset}>
                    <SelectTrigger aria-label="提供商预设" className="w-48 bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDER_PRESETS.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-9" onClick={addProvider}><PlusIcon size={14} />添加提供商</Button>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setImportOpen(true)}>导入配置 JSON</Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><PlugsIcon size={14} />{!isTauri ? '浏览器默认网络（应用代理仅桌面生效）' : activeProxy(localSettings) ? '当前网络：指定代理' : '当前网络：默认网络（不指定代理）'}</span>
                  <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" onClick={() => setSection('about')}>网络设置</Button>
                </div>
              </div>

              <div className="space-y-3">
                {localSettings.providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    isActive={p.id === localSettings.activeProviderId}
                    expanded={expandedProviderId === p.id}
                    errorFocus={providerErrorFocus?.id === p.id ? providerErrorFocus.attempt : undefined}
                    onErrorFocused={() => setProviderErrorFocus((prev) => prev?.id === p.id && prev.attempt === providerErrorFocus?.attempt ? null : prev)}
                    onExpandedChange={(open) => setExpandedProviderId(open ? p.id : null)}
                    onSetActive={() => setActiveProvider(p.id)}
                    onUpdate={(patch) => updateProvider(p.id, patch)}
                    onRemove={() => removeProvider(p.id)}
                    onTest={() => handleTestConnection(p.id)}
                    testing={testingProviderId === p.id}
                    testDisabled={testingProviderId !== null}
                    proxyUrl={activeProxy(localSettings)}
                    testResult={providerTestResults[p.id]}
                  />
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">支持 OpenAI Chat Completions、Responses、Anthropic 与 Gemini 等协议。</p>
            </section>
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
              <Field label="网络代理" hint="与桌面模型测试、拉取、生成及检查更新共用同一个代理开关">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-muted-foreground">
                    {activeProxy(localSettings) ? `已开启：${activeProxy(localSettings)}` : '未开启，使用默认网络（不指定代理）'}
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
                desc="桌面模型测试、拉取模型、生成周报与 Notion 同步、检查更新共用。模型显式代理仅桌面生效；关闭时使用默认网络，不指定代理。检查更新或下载失败时，会自动换另一条线路再试一次"
              >
                <Field label="启用代理" hint="开启后桌面模型请求、Notion 同步与检查更新使用下方地址">
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
      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) { setImportText(''); setImportError(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入模型提供商</DialogTitle>
            <DialogDescription>粘贴 CC Switch 提供商或 OpenCode V1 配置 JSON。导入会追加提供商并选中首项，现有配置会保留。不支持 V2 或任意 npm SDK。</DialogDescription>
          </DialogHeader>
          <Label htmlFor="provider-import">配置 JSON</Label>
          <Textarea id="provider-import" value={importText} onChange={(e) => { setImportText(e.target.value); setImportError(''); }} className="min-h-60 font-mono text-xs" spellCheck={false} autoComplete="off" placeholder="粘贴配置 JSON" />
          {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportText(''); setImportError(''); }}>取消</Button>
            <Button onClick={handleImport} disabled={!importText.trim()}>导入到待保存配置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
