import { useEffect, useState, useRef, useMemo } from 'react';
import { useAppStore } from '@/store';
import { fetchGitLogs, getProjectContext, getProjectAuthors } from '@/lib/git';
import { generateWeeklyReport, getActiveProvider, polishReport } from '@/lib/glm';
import { aggregateCommits, formatForPrompt, sanitizeReport, withReportHeader, findJargon, reportShape } from '@/lib/commits';
import { syncReportToNotion } from '@/lib/notion';
import { CommitLog, Report } from '@/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
  ArrowsClockwiseIcon,
  SparkleIcon,
  XIcon,
  CheckIcon,
  GitCommitIcon,
  GitBranchIcon,
  FileTextIcon,
  FolderIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  UserIcon,
  CpuIcon,
  CopyIcon,
  PaperPlaneTiltIcon,
  SpinnerIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import dayjs from 'dayjs';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import ReactMarkdown from 'react-markdown';
import { cn, projectDot } from '@/lib/utils';

// 取所在自然周的周一。用原生 day()（0=周日）自己算，不走 startOf('week')——
// 后者的周起点跟随 dayjs locale，zh-cn 下是周一，会让整个范围整体后移一天。
function mondayOf(d: dayjs.Dayjs) {
  return d.subtract((d.day() + 6) % 7, 'day').startOf('day');
}

function workWeek(monday: dayjs.Dayjs): DateRange {
  return { from: monday.toDate(), to: monday.add(4, 'day').endOf('day').toDate() };
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type StepId = 'context' | 'aggregate' | 'generation' | 'polish' | 'cleanup';
type AgentStep = { id: StepId; status: StepStatus; details?: string };

const STEP_LABELS: Record<StepId, string> = {
  context: '读取项目背景',
  aggregate: '清洗与归并',
  generation: '生成周报',
  polish: '技术词润色',
  cleanup: '清洗成稿',
};
const STEP_ORDER: StepId[] = ['context', 'aggregate', 'generation', 'polish', 'cleanup'];

// 约定式提交前缀，用来给提交行打类型标签
const COMMIT_TYPE_RE = /^(feat|fix|docs|refactor|chore|style|test|perf|ci|build|revert)(\([^)]*\))?!?[:：]\s*/i;
const TYPE_STYLE: Record<string, string> = {
  feat: 'bg-accent text-accent-foreground',
  fix: 'bg-destructive/10 text-destructive',
  refactor: 'bg-chart-2/10 text-chart-2',
  perf: 'bg-chart-2/10 text-chart-2',
};
function splitCommitType(message: string): { type?: string; text: string } {
  const m = message.match(COMMIT_TYPE_RE);
  if (!m) return { text: message };
  return { type: m[1].toLowerCase(), text: message.slice(m[0].length) };
}

function relativeDay(date: string) {
  const d = dayjs(date);
  const today = dayjs().startOf('day');
  if (d.isSame(today, 'day')) return `今天 ${d.format('HH:mm')}`;
  if (d.isSame(today.subtract(1, 'day'), 'day')) return `昨天 ${d.format('HH:mm')}`;
  return d.format('MM-DD HH:mm');
}

export default function Dashboard() {
  const { projects, settings, addReport, updateSettings, reports } = useAppStore();
  const [logs, setLogs] = useState<CommitLog[]>([]);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string>('');
  const [lastReport, setLastReport] = useState<Report | null>(null);
  const [reasoning, setReasoning] = useState<string>('');
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeProvider = getActiveProvider(settings);
  const activeProviderLabel = activeProvider ? `${activeProvider.name} (${activeProvider.model})` : '未配置模型';

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => workWeek(mondayOf(dayjs())));

  // 拖拽分隔条
  const [leftPanelWidth, setLeftPanelWidth] = useState(38); // 百分比
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setLeftPanelWidth(Math.min(70, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100)));
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const loadAuthors = async (projectsList: typeof projects) => {
    if (projectsList.length === 0) {
      setAuthors([]);
      return;
    }
    const authorLists = await Promise.all(projectsList.map((p) => getProjectAuthors(p.path)));
    const all = Array.from(new Set(authorLists.flat().filter(Boolean)));
    all.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' }));
    setAuthors(all);
  };

  useEffect(() => {
    loadAuthors(projects);
  }, [projects]);

  // 持久化数据恢复后 projects 才有值，补一次作者加载
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.projects.length > 0 && authors.length === 0) loadAuthors(state.projects);
    });
    return () => unsubscribe();
  }, [authors.length]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const loadLogs = async () => {
    if (projects.length === 0) return;
    setLoading(true);
    try {
      const since = dateRange?.from ? dayjs(dateRange.from).format('YYYY-MM-DD HH:mm:ss') : undefined;
      const until = dateRange?.to ? dayjs(dateRange.to).endOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined;
      const logsByProject = await Promise.all(projects.map((p) => fetchGitLogs(p, settings.authorName, since, until)));
      const allLogs = logsByProject.flat();
      allLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setLogs(allLogs);
      setSelectedHashes(new Set(allLogs.map((l) => l.hash)));
      toast({ title: '刷新成功', description: `共获取到 ${allLogs.length} 条提交记录` });
    } catch (error) {
      console.error(error);
      toast({ title: '获取失败', description: '请检查 Git 路径或权限', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const setStep = (id: StepId, patch: Partial<AgentStep>) =>
    setAgentSteps((prev) =>
      prev.some((s) => s.id === id) ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : [...prev, { id, status: 'pending', ...patch }]
    );

  const handleGenerate = async () => {
    if (logs.length === 0) {
      toast({ title: '无法生成', description: '当前没有 Git 提交记录', variant: 'destructive' });
      return;
    }
    if (selectedLogs.length === 0) {
      toast({ title: '无法生成', description: '请至少勾选一条提交记录', variant: 'destructive' });
      return;
    }
    if (!activeProvider?.apiKey) {
      toast({
        title: '未配置 API Key',
        description: `请先在设置页为「${activeProvider?.name || '当前模型'}」配置 API Key`,
        variant: 'destructive',
      });
      return;
    }

    setGenerating(true);
    setAgentSteps([]);
    setGeneratedReport('');
    setLastReport(null);
    setReasoning('');
    abortControllerRef.current = new AbortController();

    try {
      // 步骤 1：读取项目背景（仅本次勾选涉及的项目）
      const activeProjectNames = new Set(selectedLogs.map((l) => l.project));
      const activeProjects = projects.filter((p) => activeProjectNames.has(p.alias || p.name));
      setStep('context', { status: 'running', details: `正在分析 ${activeProjects.length} 个项目` });

      let projectContext = '';
      try {
        const contexts = await Promise.all(activeProjects.map((p) => getProjectContext(p)));
        projectContext = contexts.join('\n');
        setStep('context', { status: 'completed', details: `已读取 ${activeProjects.length} 个项目的背景资料` });
      } catch (e) {
        console.warn('Failed to fetch project context', e);
        setStep('context', { status: 'failed', details: '读取项目背景失败，继续生成' });
      }

      // 步骤 2：清洗并按项目/模块归并（确定性处理）
      setStep('aggregate', { status: 'running', details: `正在处理 ${selectedLogs.length} 条提交` });
      const aggregated = aggregateCommits(selectedLogs);
      const commitsText = formatForPrompt(aggregated);
      const keptItems = aggregated.groups.reduce((n, g) => n + g.items.length, 0);
      setStep('aggregate', {
        status: 'completed',
        details:
          `${aggregated.totalInput} 条提交 → ${aggregated.groups.length} 个模块组 / ${keptItems} 条待提炼` +
          `（过滤噪音 ${aggregated.droppedNoise} 条，重复合并 ${aggregated.deduped} 条` +
          (aggregated.truncated > 0 ? `，超出上限省略 ${aggregated.truncated} 条` : '') +
          '）',
      });
      if (keptItems === 0) {
        throw new Error('所选提交经过滤后没有可用内容（可能全部是合并、版本号或临时提交）');
      }

      // 步骤 3：调用模型生成
      setStep('generation', { status: 'running', details: `${activeProviderLabel} 流式输出中` });
      const rawReport = await generateWeeklyReport(
        settings,
        settings.promptTemplate,
        commitsText,
        projectContext,
        (chunk) => setGeneratedReport(chunk),
        (chunk) => setReasoning(chunk),
        abortControllerRef.current.signal
      );
      setStep('generation', { status: 'completed', details: `已生成 ${rawReport.length} 字` });

      // 步骤 4：兜底清洗；仍有技术词才二次润色，干净时跳过，不产生额外调用
      const rangeStart = dateRange?.from ? dayjs(dateRange.from).format('YYYY-MM-DD') : '';
      const rangeEnd = dateRange?.to ? dayjs(dateRange.to).format('YYYY-MM-DD') : '';
      let cleaned = sanitizeReport(rawReport);
      const removed = rawReport.length - cleaned.length;

      const jargon = findJargon(cleaned);
      if (jargon.length === 0) {
        setStep('polish', { status: 'skipped', details: '未发现残留技术词，跳过润色' });
      } else {
        setStep('polish', {
          status: 'running',
          details: `发现 ${jargon.length} 处读者看不懂的词：${jargon.slice(0, 6).join('、')}${jargon.length > 6 ? ' 等' : ''}`,
        });
        try {
          const polished = await polishReport(settings, cleaned, jargon, abortControllerRef.current.signal);
          const cleanedPolished = sanitizeReport(polished);
          const left = findJargon(cleanedPolished);
          // 结构被改动或没改善，一律退回原稿——宁可留几个词，也不能把周报改坏
          const shapeKept = reportShape(cleanedPolished) === reportShape(cleaned);
          const improved = left.length < jargon.length;
          if (shapeKept && improved) {
            cleaned = cleanedPolished;
            setStep('polish', {
              status: 'completed',
              details: `已改写 ${jargon.length - left.length} 处${left.length ? `，仍剩 ${left.length} 处` : '，全部处理完毕'}`,
            });
          } else {
            setStep('polish', { status: 'completed', details: shapeKept ? '润色没有改善，保留原稿' : '润色改动了周报结构，已退回原稿' });
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') throw e;
          console.warn('Polish failed, keeping original', e);
          setStep('polish', { status: 'failed', details: `润色失败，保留原稿：${e?.message || e}` });
        }
      }

      const reportContent = withReportHeader(cleaned, rangeStart, rangeEnd);
      setStep('cleanup', {
        status: 'completed',
        details: removed > 0 ? `清除了 ${removed} 个字符的技术标记` : '未发现需要清除的技术标记',
      });
      setGeneratedReport(reportContent);

      if (!reportContent.trim()) {
        throw new Error('模型没有产出有效内容，本次不保存');
      }

      const newReport: Report = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        dateRange: { start: rangeStart, end: rangeEnd },
        content: reportContent,
        status: 'generated',
        projects: Array.from(new Set(selectedLogs.map((l) => l.project))),
        branches: Array.from(new Set(selectedLogs.map((l) => l.branch).filter(Boolean) as string[])),
        totalCommits: selectedLogs.length,
      };
      addReport(newReport);
      setLastReport(newReport);

      if (settings.notionAutoSync) {
        try {
          const notionResult = await syncReportToNotion(newReport, settings);
          const syncDescription =
            settings.notionSyncMode === 'subpage' ? '已保存至历史记录，并创建 Notion 子页面' : '已保存至历史记录，并追加到 Notion 文档正文';
          toast({ title: '周报生成成功', description: notionResult.url ? syncDescription : '已保存至历史记录，并完成 Notion 同步' });
        } catch (syncError: any) {
          toast({ title: '周报已保存', description: `已保存至历史记录，${syncError.message || 'Notion 同步失败'}`, variant: 'destructive' });
        }
      } else {
        toast({ title: '周报生成成功', description: '已保存至历史记录' });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast({ title: '生成已取消', description: '用户手动停止或切换页面' });
      } else {
        toast({ title: '生成失败', description: error.message, variant: 'destructive' });
        setAgentSteps((prev) => {
          const running = prev.find((s) => s.status === 'running') ?? prev[prev.length - 1];
          return running ? prev.map((s) => (s.id === running.id ? { ...s, status: 'failed', details: error.message } : s)) : prev;
        });
      }
    } finally {
      setGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopGenerate = () => abortControllerRef.current?.abort();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedReport);
      toast({ title: '已复制', description: '周报 Markdown 已复制到剪贴板' });
    } catch {
      toast({ title: '复制失败', description: '无法访问剪贴板', variant: 'destructive' });
    }
  };

  const handleSyncNotion = async () => {
    if (!lastReport) return;
    setSyncing(true);
    try {
      await syncReportToNotion(lastReport, settings);
      toast({ title: 'Notion 同步成功' });
    } catch (e: any) {
      toast({ title: 'Notion 同步失败', description: e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const dateRangeFromTs = dateRange?.from?.getTime();
  const dateRangeToTs = dateRange?.to?.getTime();

  useEffect(() => {
    // 仅在日期范围完整时自动刷新，避免只选开始日期就触发请求
    if (!dateRangeFromTs || !dateRangeToTs) return;
    if (useAppStore.getState().projects.length > 0) void loadLogs();
  }, [projects, settings.authorName, dateRangeFromTs, dateRangeToTs]);

  const groupedLogs = useMemo(() => {
    const groups: Record<string, CommitLog[]> = {};
    logs.forEach((log) => {
      (groups[log.project] ??= []).push(log);
    });
    return groups;
  }, [logs]);

  const selectedLogs = useMemo(() => logs.filter((l) => selectedHashes.has(l.hash)), [logs, selectedHashes]);
  const selectedBranches = useMemo(() => new Set(selectedLogs.map((l) => l.branch).filter(Boolean)).size, [selectedLogs]);

  const toggleCommit = (hash: string) =>
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      next.has(hash) ? next.delete(hash) : next.add(hash);
      return next;
    });

  const toggleProject = (projectLogs: CommitLog[]) => {
    const allSelected = projectLogs.every((l) => selectedHashes.has(l.hash));
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      projectLogs.forEach((l) => (allSelected ? next.delete(l.hash) : next.add(l.hash)));
      return next;
    });
  };

  // 分段按钮：本周 / 上周 / 自定义
  const thisMonday = mondayOf(dayjs());
  const rangeKey = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return 'custom';
    const from = dayjs(dateRange.from);
    const to = dayjs(dateRange.to);
    if (!from.isSame(mondayOf(from), 'day') || to.diff(from, 'day') !== 4) return 'custom';
    if (from.isSame(thisMonday, 'day')) return 'this';
    if (from.isSame(thisMonday.subtract(1, 'week'), 'day')) return 'last';
    return 'custom';
  }, [dateRange, thisMonday]);

  const fmt = (d?: Date) => (d ? dayjs(d).format('MM-DD') : '…');

  const weekProgress = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return { value: '—', hint: '' };
    const start = dayjs(dateRange.from);
    const end = dayjs(dateRange.to);
    const total = Math.min(end.diff(start, 'day') + 1, 7);
    if (rangeKey === 'this') {
      const elapsed = Math.min(Math.max(dayjs().startOf('day').diff(thisMonday, 'day') + 1, 1), total);
      return { value: `第 ${elapsed} 天`, hint: `/ ${total}`, tag: dayjs().format('dddd') };
    }
    return { value: `${total} 天`, hint: '', tag: '历史周期' };
  }, [dateRange, rangeKey, thisMonday]);

  const stepMap = useMemo(() => new Map(agentSteps.map((s) => [s.id, s])), [agentSteps]);
  const currentStep = agentSteps.find((s) => s.status === 'running') ?? agentSteps[agentSteps.length - 1];
  const hasOutput = Boolean(generatedReport || reasoning || generating || agentSteps.length > 0);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-6 py-5">
      {/* 页头 */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">仪表盘</h1>
          <p className="page-subtitle">
            {projects.length} 个项目 · 作者 {settings.authorName || '全部'} · {fmt(dateRange?.from)} 至 {fmt(dateRange?.to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 items-center rounded-md border border-border bg-muted p-[3px]">
            {(
              [
                ['this', '本周', () => setDateRange(workWeek(thisMonday))],
                ['last', '上周', () => setDateRange(workWeek(thisMonday.subtract(1, 'week')))],
              ] as const
            ).map(([key, label, onClick]) => (
              <button
                key={key}
                onClick={onClick}
                className={cn(
                  'h-full rounded-[5px] px-3 text-[13px] font-medium text-muted-foreground transition-colors',
                  rangeKey === key && 'bg-card text-foreground shadow-sm'
                )}
              >
                {label}
              </button>
            ))}
            <span className={cn('h-full rounded-[5px]', rangeKey === 'custom' && 'bg-card shadow-sm')}>
              <DatePickerWithRange date={dateRange} setDate={setDateRange} className="[&_button]:w-auto [&_button]:h-full [&_button]:border-0 [&_button]:bg-transparent [&_button]:shadow-none [&_button]:text-[13px]" />
            </span>
          </div>
          <Select
            value={settings.authorName || 'all'}
            onValueChange={(val) => updateSettings({ authorName: val === 'all' ? '' : val })}
          >
            <SelectTrigger className="h-9 w-auto min-w-[150px] gap-2 text-[13px]">
              <UserIcon size={14} className="text-muted-foreground" />
              <SelectValue placeholder="全部作者" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部作者</SelectItem>
              {authors.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadLogs} disabled={loading || generating}>
            <ArrowsClockwiseIcon size={16} className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </div>
      </div>

      {/* 统计 */}
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<GitCommitIcon size={20} />} tone="primary" label="本周提交" value={logs.length} sub={`已选 ${selectedLogs.length}`} tag="当前筛选范围" />
        <StatTile icon={<FileTextIcon size={20} />} tone="success" label="已生成周报" value={reports.length} tag="历史总计" />
        <StatTile
          icon={<FolderIcon size={20} />}
          tone="blue"
          label="活跃项目"
          value={Object.keys(groupedLogs).length}
          sub={`/ ${projects.length}`}
          tag={Object.keys(groupedLogs).length === projects.length && projects.length > 0 ? '全部有提交' : '有提交的项目'}
        />
        <StatTile icon={<CalendarBlankIcon size={20} />} tone="warning" label="统计周期" value={weekProgress.value} sub={weekProgress.hint} tag={weekProgress.tag} />
      </div>

      {/* 工作区 */}
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden rounded-[10px] border border-border bg-card shadow-sm">
        {/* 左：提交列表 */}
        <div className="flex h-full flex-col overflow-hidden" style={{ width: `${leftPanelWidth}%` }}>
          <div className="flex min-h-[54px] shrink-0 items-center gap-3 border-b border-border px-3.5">
            <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold">提交记录</h2>
            <div className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1" title="已选 / 提交总数">
                <GitCommitIcon size={13} /> {selectedLogs.length} / {logs.length} 已选
              </span>
              <span className="inline-flex items-center gap-1" title="已选提交涉及分支">
                <GitBranchIcon size={13} /> {selectedBranches} 分支
              </span>
            </div>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setSelectedHashes(new Set(logs.map((l) => l.hash)))} disabled={logs.length === 0}>
                全选
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedHashes(new Set())} disabled={selectedHashes.size === 0}>
                清空
              </Button>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <GitCommitIcon size={28} className="opacity-40" />
                <p className="text-sm">{loading ? '正在读取提交…' : projects.length === 0 ? '还没有项目，先在左侧「添加项目」' : '该范围内没有提交，换个日期试试'}</p>
              </div>
            ) : (
              Object.entries(groupedLogs).map(([project, projectLogs]) => {
                const selectedInProject = projectLogs.filter((l) => selectedHashes.has(l.hash)).length;
                const allSelected = selectedInProject === projectLogs.length;
                return (
                  <Collapsible key={project} defaultOpen className="group/collapsible">
                    <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border bg-card px-3.5 py-2">
                      <Checkbox
                        checked={allSelected ? true : selectedInProject === 0 ? false : 'indeterminate'}
                        onCheckedChange={() => toggleProject(projectLogs)}
                        aria-label={`全选 ${project}`}
                      />
                      <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', projectDot(project))} />
                        <span className="truncate text-[13px] font-semibold">{project}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {selectedInProject} / {projectLogs.length} 已选
                        </span>
                        <CaretDownIcon size={14} className="ml-auto shrink-0 text-muted-foreground transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      {projectLogs.map((log) => {
                        const checked = selectedHashes.has(log.hash);
                        const { type, text } = splitCommitType(log.message);
                        return (
                          <label
                            key={log.hash}
                            className="grid cursor-pointer grid-cols-[16px_1fr_auto] items-start gap-3 border-b border-border px-3.5 py-2.5 transition-colors hover:bg-muted/60"
                          >
                            <Checkbox className="mt-0.5" checked={checked} onCheckedChange={() => toggleCommit(log.hash)} aria-label="选择此提交" />
                            <div className="min-w-0">
                              <div className={cn('text-[13px] leading-snug break-words', !checked && 'text-muted-foreground')}>
                                {type && (
                                  <span className={cn('mr-1.5 inline-block rounded px-1.5 font-mono text-[11px] leading-[18px] align-[1px]', TYPE_STYLE[type] ?? 'bg-muted text-muted-foreground')}>
                                    {type}
                                  </span>
                                )}
                                {text}
                              </div>
                              <div className="mt-1 flex items-center gap-2.5 text-[11px] text-muted-foreground">
                                <code className="font-mono">{log.hash.slice(0, 7)}</code>
                                {log.branch && (
                                  <span className="inline-flex items-center gap-1">
                                    <GitBranchIcon size={12} /> {log.branch}
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1">
                                  <UserIcon size={12} /> {log.author}
                                </span>
                              </div>
                            </div>
                            <span className="whitespace-nowrap pt-0.5 text-[11px] tabular-nums text-muted-foreground">{relativeDay(log.date)}</span>
                          </label>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })
            )}
          </ScrollArea>
        </div>

        {/* 分隔条 */}
        <div
          onMouseDown={handleMouseDown}
          className="group relative w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
        >
          <span className="absolute left-[1px] top-1/2 h-9 w-1 -translate-y-1/2 rounded bg-input group-hover:bg-primary" />
        </div>

        {/* 右：周报预览 */}
        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <div className="flex min-h-[54px] shrink-0 items-center gap-3 border-b border-border px-3.5">
            <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold">周报预览</h2>
            <span className="truncate text-xs text-muted-foreground">
              {generating ? `AI 生成中 · 已生成 ${generatedReport.length} 字` : generatedReport ? '生成完成' : '选择提交后点击生成'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Select value={settings.activeProviderId} onValueChange={(id) => updateSettings({ activeProviderId: id })} disabled={generating}>
                <SelectTrigger className="h-9 w-auto min-w-[130px] gap-2 text-[13px]">
                  <CpuIcon size={14} className="text-muted-foreground" />
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {settings.providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {generating ? (
                <Button variant="outline" onClick={handleStopGenerate}>
                  <XIcon size={16} />
                  停止
                </Button>
              ) : (
                <Button onClick={handleGenerate} disabled={selectedLogs.length === 0}>
                  <SparkleIcon size={16} weight="fill" />
                  生成周报
                </Button>
              )}
            </div>
          </div>

          {agentSteps.length > 0 && (
            <div className="shrink-0 border-b border-border bg-muted/60 px-3.5 py-2">
              <div className="flex items-center overflow-x-auto text-xs">
                {STEP_ORDER.map((id, i) => {
                  const st = stepMap.get(id)?.status ?? 'pending';
                  return (
                    <div key={id} className="flex items-center whitespace-nowrap">
                      {i > 0 && <span className="mx-2 h-px w-5 shrink-0 bg-input" />}
                      <StepDot status={st} index={i + 1} />
                      <span
                        className={cn(
                          'ml-1.5',
                          st === 'running' ? 'font-medium text-primary' : st === 'pending' ? 'text-muted-foreground/70' : st === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                        )}
                      >
                        {STEP_LABELS[id]}
                        {st === 'skipped' && <span className="ml-1 text-muted-foreground/70">已跳过</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {currentStep?.details && <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{currentStep.details}</p>}
            </div>
          )}

          {hasOutput ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-7 py-5">
                {(reasoning || (generating && !generatedReport)) && (
                  <Reasoning isStreaming={generating && !generatedReport} className="mb-4">
                    <ReasoningTrigger />
                    <ReasoningContent>{reasoning}</ReasoningContent>
                  </Reasoning>
                )}
                {generatedReport && (
                  <div className="report-md">
                    <ReactMarkdown>{generatedReport}</ReactMarkdown>
                    {generating && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary align-[-2px]" />}
                  </div>
                )}
                {!generatedReport && generating && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <SpinnerIcon size={16} className="animate-spin" /> 正在思考并撰写周报…
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-10 text-center text-muted-foreground">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
                <SparkleIcon size={26} weight="fill" />
              </div>
              <p className="font-semibold text-foreground">还没有生成周报</p>
              <p className="text-[13px] leading-relaxed">
                {selectedLogs.length > 0 ? `左侧已勾选 ${selectedLogs.length} 条提交，` : '先在左侧勾选要纳入的提交，'}
                模型会按「项目 → 功能」归并成条，
                <br />
                并自动过滤版本号、合并等噪音提交。
              </p>
              {selectedLogs.length > 0 && (
                <Button className="mt-1.5" onClick={handleGenerate}>
                  <SparkleIcon size={16} weight="fill" />
                  立即生成
                </Button>
              )}
            </div>
          )}

          {generatedReport && !generating && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-3.5 py-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                {lastReport ? (
                  <>
                    <CheckIcon size={13} className="text-success" weight="bold" />
                    已保存到历史{settings.notionAutoSync && '，并已同步到 Notion'}
                  </>
                ) : (
                  <>
                    <WarningCircleIcon size={13} className="text-warning" />
                    本次生成未保存
                  </>
                )}
              </span>
              <div className="ml-auto flex gap-1.5">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  <CopyIcon size={14} />
                  复制
                </Button>
                {lastReport && settings.notionApiKey && (
                  <Button variant="outline" size="sm" onClick={handleSyncNotion} disabled={syncing}>
                    {syncing ? <SpinnerIcon size={14} className="animate-spin" /> : <PaperPlaneTiltIcon size={14} />}
                    同步 Notion
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  primary: 'bg-accent text-accent-foreground',
  success: 'bg-success/10 text-success',
  blue: 'bg-chart-2/10 text-chart-2',
  warning: 'bg-warning/10 text-warning',
};

function StatTile({
  icon,
  tone,
  label,
  value,
  sub,
  tag,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tag?: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-[10px] border border-border bg-card px-4 py-3.5 shadow-sm">
      <div className={cn('grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[9px]', TONE[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="whitespace-nowrap text-xs text-muted-foreground">{label}</div>
        <div className="whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight tabular-nums">
          {value}
          {sub && <span className="ml-1 text-xs font-medium text-muted-foreground">{sub}</span>}
        </div>
      </div>
      {tag && <span className="ml-auto hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground xl:inline-flex">{tag}</span>}
    </div>
  );
}

function StepDot({ status, index }: { status: StepStatus; index: number }) {
  const base = 'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] text-[10px] font-semibold';
  if (status === 'completed' || status === 'skipped')
    return (
      <span className={cn(base, 'border-success bg-success text-success-foreground', status === 'skipped' && 'opacity-50')}>
        <CheckIcon size={10} weight="bold" />
      </span>
    );
  if (status === 'running')
    return (
      <span className={cn(base, 'border-primary text-primary')}>
        <SpinnerIcon size={10} weight="bold" className="animate-spin" />
      </span>
    );
  if (status === 'failed')
    return (
      <span className={cn(base, 'border-destructive bg-destructive text-destructive-foreground')}>
        <XIcon size={10} weight="bold" />
      </span>
    );
  return <span className={cn(base, 'border-input text-muted-foreground')}>{index}</span>;
}
