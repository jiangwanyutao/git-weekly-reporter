
import { useEffect, useState, useRef, useMemo } from 'react';
import { useAppStore } from '@/store';
import { fetchGitLogs, getProjectContext, getProjectAuthors } from '@/lib/git';
import { generateWeeklyReport } from '@/lib/glm';
import { syncReportToNotion } from '@/lib/notion';
import { CommitLog, Report } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Sparkles, StopCircle, CheckCircle2, Circle, GitCommit, FileText, Activity, Calendar, GitBranch, GripVertical } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Task, TaskTrigger, TaskContent } from '@/components/ai-elements/task';
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import dayjs from 'dayjs';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from "react-day-picker";
import ReactMarkdown from 'react-markdown';


type AgentStep = {
  id: string;
  type: 'task';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  details?: string;
  tools?: {
    id: string;
    name: string;
    input: any;
    output: any;
    state: 'running' | 'completed' | 'failed';
  }[];
};

export default function Dashboard() {
  const { projects, settings, addReport, updateSettings, reports } = useAppStore();
  const [logs, setLogs] = useState<CommitLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string>('');
  const [reasoning, setReasoning] = useState<string>('');
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 默认日期范围：本周一到本周五
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: dayjs().startOf('week').add(1, 'day').toDate(), // 周一
    to: dayjs().endOf('week').subtract(1, 'day').toDate(), // 周五
  });

  // 拖拽分隔条相关状态
  const [leftPanelWidth, setLeftPanelWidth] = useState(40); // 百分比
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // 拖拽处理函数
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      // 限制在 20% - 70% 之间
      setLeftPanelWidth(Math.min(70, Math.max(20, newWidth)));
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

  // 加载所有项目的作者列表
  const loadAuthors = async (projectsList: typeof projects) => {
    if (projectsList.length === 0) {
      setAuthors([]);
      return;
    }
    const authorLists = await Promise.all(
      projectsList.map((p) => getProjectAuthors(p.path))
    );
    const allAuthors = Array.from(new Set(authorLists.flat().filter(Boolean)));
    allAuthors.sort((a, b) =>
      a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' })
    );
    setAuthors(allAuthors);
  };

  // 当 projects 变化时加载作者（包括初次渲染和后续更新）
  useEffect(() => {
    loadAuthors(projects);
  }, [projects]);

  // 订阅 zustand 状态恢复，确保在持久化数据恢复后也能加载作者
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe(
      (state) => {
        // 当持久化数据恢复后，projects 会从空数组变为有值
        if (state.projects.length > 0 && authors.length === 0) {
          loadAuthors(state.projects);
        }
      }
    );
    return () => unsubscribe();
  }, [authors.length]);

  // 组件卸载时中断请求
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // 加载 Git 记录
  const loadLogs = async () => {
    if (projects.length === 0) return;
    setLoading(true);
    try {
      const since = dateRange?.from ? dayjs(dateRange.from).format('YYYY-MM-DD HH:mm:ss') : undefined;
      const until = dateRange?.to ? dayjs(dateRange.to).endOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined;

      const logsByProject = await Promise.all(
        projects.map((project) =>
          fetchGitLogs(
            project.path,
            settings.authorName,
            since,
            until,
            project.alias || project.name
          )
        )
      );
      const allLogs: CommitLog[] = logsByProject.flat();
      // 按时间倒序
      allLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setLogs(allLogs);
      toast({ title: "刷新成功", description: `共获取到 ${allLogs.length} 条提交记录` });
    } catch (error) {
      console.error(error);
      toast({ title: "获取失败", description: "请检查 Git 路径或权限", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // 生成周报
  const handleGenerate = async () => {
    if (logs.length === 0) {
      toast({ title: "无法生成", description: "当前没有 Git 提交记录", variant: "destructive" });
      return;
    }
    if (!settings.glmApiKey) {
      toast({ title: "未配置 API Key", description: "请先在设置页配置 GLM API Key", variant: "destructive" });
      return;
    }

    setGenerating(true);
    setAgentSteps([]); // Clear previous steps
    setGeneratedReport('');
    setReasoning('');

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    try {
      // Step 1: Intent Recognition
      setAgentSteps(prev => [...prev, {
        id: 'intent',
        type: 'task',
        title: 'Intent Recognition',
        status: 'completed',
        details: 'User Request: Generate Weekly Report',
        tools: []
      }]);

      // Step 2: Project Analysis
      const analysisStepId = 'analysis';
      setAgentSteps(prev => [...prev, {
        id: analysisStepId,
        type: 'task',
        title: 'Project Analysis',
        status: 'running',
        details: 'Analyzing project structure and dependencies...',
        tools: []
      }]);

      // Simulate tool call for analysis
      await new Promise(r => setTimeout(r, 500));

      setAgentSteps(prev => prev.map(s => s.id === analysisStepId ? {
        ...s,
        tools: [{
          id: 'tool-read-pkg',
          name: 'read_file',
          input: { path: 'package.json' },
          output: 'Reading...',
          state: 'running'
        }]
      } : s));

      // 获取项目上下文 (Agent 能力)
      let projectContext = "";
      try {
        const contexts = await Promise.all(projects.map(p => getProjectContext(p.path)));
        projectContext = contexts.join('\n');

        setAgentSteps(prev => prev.map(s => s.id === analysisStepId ? {
          ...s,
          status: 'completed',
          details: `Analyzed ${projects.length} projects.`,
          tools: [{
            id: 'tool-read-pkg',
            name: 'read_file',
            input: { path: 'package.json/README.md' },
            output: { summary: 'Context extracted successfully' },
            state: 'completed'
          }]
        } : s));
      } catch (e) {
        console.warn("Failed to fetch project context", e);
        setAgentSteps(prev => prev.map(s => s.id === analysisStepId ? { ...s, status: 'failed' } : s));
      }

      // Step 3: Git History
      const gitStepId = 'git-history';
      setAgentSteps(prev => [...prev, {
        id: gitStepId,
        type: 'task',
        title: 'Commit History Analysis',
        status: 'running',
        details: `Processing ${logs.length} commits...`,
        tools: []
      }]);

      // 格式化 commit 记录供 AI 阅读
      const commitsText = logs.map(log => `[${log.project}] ${log.message} (${log.date})`).join('\n');

      await new Promise(r => setTimeout(r, 600));

      setAgentSteps(prev => prev.map(s => s.id === gitStepId ? {
        ...s,
        status: 'completed',
        tools: [{
          id: 'tool-git-log',
          name: 'git_log',
          input: { since: dateRange?.from, until: dateRange?.to },
          output: { count: logs.length },
          state: 'completed'
        }]
      } : s));

      // Step 4: Report Generation
      const genStepId = 'generation';
      setAgentSteps(prev => [...prev, {
        id: genStepId,
        type: 'task',
        title: 'Report Generation',
        status: 'running',
        details: 'Streaming content from GLM-4.7...',
        tools: []
      }]);

      const reportContent = await generateWeeklyReport(
        settings.glmApiKey,
        settings.promptTemplate,
        commitsText,
        projectContext,
        (chunk) => {
          setGeneratedReport(chunk); // 实时更新 UI
        },
        (chunk) => {
          setReasoning(chunk); // 实时更新推理内容
        },
        abortControllerRef.current.signal
      );

      // Finalize
      setAgentSteps(prev => prev.map(s => s.id === genStepId ? { ...s, status: 'completed' } : s));
      setGeneratedReport(reportContent);

      // 保存到历史记录
      const newReport: Report = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        dateRange: {
          start: dateRange?.from ? dayjs(dateRange.from).format('YYYY-MM-DD') : '',
          end: dateRange?.to ? dayjs(dateRange.to).format('YYYY-MM-DD') : '',
        },
        content: reportContent,
        status: 'generated',
        projects: Object.keys(groupedLogs),
        branches: Array.from(new Set(logs.map(l => l.branch).filter(Boolean) as string[])),
        totalCommits: logs.length,
      };
      addReport(newReport);

      if (settings.notionAutoSync) {
        try {
          const notionResult = await syncReportToNotion(newReport, settings);
          const syncDescription = settings.notionSyncMode === 'subpage'
            ? '已保存至历史记录，并创建 Notion 子页面'
            : '已保存至历史记录，并追加到 Notion 文档正文';
          toast({
            title: "周报生成成功",
            description: notionResult.url ? syncDescription : "已保存至历史记录，并完成 Notion 同步",
          });
        } catch (syncError: any) {
          toast({
            title: "周报已保存",
            description: `已保存至历史记录，${syncError.message || 'Notion 同步失败'}`,
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "周报生成成功", description: "已保存至历史记录" });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast({ title: "生成已取消", description: "用户手动停止或切换页面" });
      } else {
        toast({ title: "生成失败", description: error.message, variant: "destructive" });
        setAgentSteps(prev => {
          const last = prev[prev.length - 1];
          if (last) return prev.map(s => s.id === last.id ? { ...s, status: 'failed' } : s);
          return prev;
        });
      }
    } finally {
      setGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopGenerate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const dateRangeFromTs = dateRange?.from?.getTime();
  const dateRangeToTs = dateRange?.to?.getTime();

  useEffect(() => {
    // 仅在日期范围完整时自动刷新，避免只选开始日期就触发请求
    if (!dateRangeFromTs || !dateRangeToTs) return;

    const state = useAppStore.getState();
    if (state.projects.length > 0) {
      void loadLogs();
    }
  }, [projects, settings.authorName, dateRangeFromTs, dateRangeToTs]); // 项目/作者/日期变化时自动刷新

  // 按项目分组
  const groupedLogs = useMemo(() => {
    const groups: Record<string, CommitLog[]> = {};
    logs.forEach(log => {
      if (!groups[log.project]) {
        groups[log.project] = [];
      }
      groups[log.project].push(log);
    });
    return groups;
  }, [logs]);

  // 格式化日期显示 (中文)
  const formatDate = (date: Date | undefined) => {
    return date ? dayjs(date).format('YYYY年MM月DD日') : '...';
  };

  const activeProjectsCount = useMemo(() => {
    return Object.keys(groupedLogs).length;
  }, [groupedLogs]);

  const daysInWeek = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '0/5';

    const today = dayjs();
    const start = dayjs(dateRange.from);

    // 如果是本周（开始时间是本周一），则计算 "今天 - 周一 + 1"
    if (today.isSame(start, 'week')) {
      // 限制最大为 5 (防止周末显示 6/5 或 7/5)
      const currentDay = Math.min(today.day() || 7, 5); // 周日(0)转为7，再限制为5
      return `${currentDay}/5`;
    }

    // 如果不是本周（是历史周），则显示选定范围的天数
    const end = dayjs(dateRange.to);
    const diff = end.diff(start, 'day') + 1;
    return `${Math.min(diff, 5)}/5`;
  }, [dateRange]);

  return (
    <div className="flex-1 p-2 space-y-6 h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 shrink-0">
        <div className="flex justify-between items-start flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-muted-foreground text-sm">当前监听 {projects.length} 个项目，作者筛选:</span>
              <Select
                value={settings.authorName || 'all'}
                onValueChange={(val) => {
                  updateSettings({ ...settings, authorName: val === 'all' ? '' : val });
                }}
              >
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue placeholder="全部作者" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部作者</SelectItem>
                  {authors.map(a => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <DatePickerWithRange date={dateRange} setDate={setDateRange} />
            <Button variant="outline" onClick={loadLogs} disabled={loading || generating}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 统计卡片区域 */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-3 stat-card gradient-border cursor-default">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-1">
              <CardTitle className="text-sm font-medium">本周提交</CardTitle>
              <GitCommit className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">{logs.length}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                基于当前筛选范围
              </p>
            </CardContent>
          </Card>
          <Card className="p-3 stat-card gradient-border cursor-default">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-1">
              <CardTitle className="text-sm font-medium">已生成报告</CardTitle>
              <FileText className="h-4 w-4 text-secondary" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="text-2xl font-bold bg-gradient-to-r from-secondary to-primary bg-clip-text text-transparent">{reports.length}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                历史总计
              </p>
            </CardContent>
          </Card>
          <Card className="p-3 stat-card gradient-border cursor-default">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-1">
              <CardTitle className="text-sm font-medium">活跃项目</CardTitle>
              <Activity className="h-4 w-4 text-chart-3" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="text-2xl font-bold">{activeProjectsCount}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                有提交记录的项目
              </p>
            </CardContent>
          </Card>
          <Card className="p-3 stat-card gradient-border cursor-default">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-0 pb-1">
              <CardTitle className="text-sm font-medium">本周天数</CardTitle>
              <Calendar className="h-4 w-4 text-chart-4" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="text-2xl font-bold">{daysInWeek}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                当前统计周期
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div ref={containerRef} className="h-full rounded-lg border flex">
          {/* 左侧：提交记录列表 (按项目分组) */}
          <div
            className="h-full flex flex-col overflow-hidden"
            style={{ width: `${leftPanelWidth}%` }}
          >
            <Card className="flex flex-col h-full shadow-none border-0">
              <CardHeader className="pb-3 shrink-0 px-2 pt-2">
                <CardTitle>提交记录</CardTitle>
                <CardDescription>
                  {formatDate(dateRange?.from)} 至 {formatDate(dateRange?.to)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-2 space-y-4">
                    {logs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        暂无数据，请检查日期范围或刷新
                      </div>
                    ) : (
                      Object.entries(groupedLogs).map(([project, projectLogs]) => (
                        <div key={project} className="space-y-2 border rounded-md px-2 bg-card">
                          <div className="sticky top-0 bg-card z-10 py-2 border-b flex items-center justify-between">
                            <h3 className="font-semibold text-sm flex items-center">
                              <Badge variant="secondary" className="mr-2">{project}</Badge>
                              <span className="text-muted-foreground text-xs">({projectLogs.length} commits)</span>
                            </h3>
                          </div>
                          <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            <div className="space-y-1">
                              {projectLogs.map((log) => (
                                <div key={log.hash} className="text-sm p-2 rounded-md commit-item group">
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex flex-col gap-1 min-w-0">
                                      <span className="font-medium break-all leading-snug">{log.message}</span>
                                      {log.branch && (
                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground group-hover:text-accent-foreground/80">
                                          <GitBranch className="h-3 w-3" />
                                          <span>{log.branch}</span>
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 opacity-70 group-hover:text-accent-foreground group-hover:opacity-100">
                                      {dayjs(log.date).format('MM-DD HH:mm')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* 可拖拽的分隔条 */}
          <div
            onMouseDown={handleMouseDown}
            className="w-1.5 h-full bg-border hover:bg-primary/50 cursor-col-resize flex items-center justify-center transition-colors shrink-0 group"
          >
            <GripVertical className="h-6 w-6 text-muted-foreground group-hover:text-primary" />
          </div>

          {/* 右侧：生成结果预览 */}
          <div className="flex-1 h-full flex flex-col overflow-hidden">
            <Card className="flex flex-col h-full shadow-none border-0">
              <CardHeader className="pb-3 border-b shrink-0 px-2 pt-2 flex flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    周报预览
                    {generating && <Badge variant="secondary" className="animate-pulse">AI 生成中...</Badge>}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-3">
                    <span>{generatedReport ? 'AI 生成结果' : '点击生成按钮开始'}</span>
                    {logs.length > 0 && (
                      <>
                        <span className="flex items-center gap-1" title="提交总数"><GitCommit className="h-3 w-3" /> {logs.length}</span>
                        <span className="flex items-center gap-1" title="涉及分支"><GitBranch className="h-3 w-3" /> {Array.from(new Set(logs.map(l => l.branch).filter(Boolean))).length} 分支</span>
                      </>
                    )}
                  </CardDescription>
                </div>
                {generating ? (
                  <Button variant="destructive" size="sm" onClick={handleStopGenerate}>
                    <StopCircle className="mr-2 h-4 w-4" />
                    停止
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleGenerate} disabled={logs.length === 0} className="glow-button">
                    <Sparkles className="mr-2 h-4 w-4" />
                    生成周报
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2 overflow-hidden rounded-b-lg">
                {generatedReport || reasoning || generating || agentSteps.length > 0 ? (
                  <ScrollArea className="h-full pr-4">
                    {/* Agent Steps */}
                    {agentSteps.length > 0 && (
                      <div className="space-y-4 mb-4">
                        {agentSteps.map(step => (
                          <Task key={step.id} defaultOpen={step.status === 'running' || step.status === 'failed'}>
                            <TaskTrigger title={step.title} className="w-full">
                              <div className="flex items-center gap-2">
                                {step.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                                {step.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                {step.status === 'failed' && <Circle className="h-4 w-4 text-red-500" />}
                                {step.status === 'pending' && <Circle className="h-4 w-4 text-muted-foreground" />}
                                <span>{step.title}</span>
                              </div>
                            </TaskTrigger>
                            <TaskContent>
                              {step.details && <p className="text-muted-foreground mb-2 text-xs">{step.details}</p>}
                              {step.tools?.map(tool => (
                                <Tool key={tool.id} className="mb-2">
                                  <ToolHeader
                                    type="function"
                                    toolName={tool.name}
                                    state={tool.state}
                                  />
                                  <ToolContent>
                                    <ToolInput input={tool.input} />
                                    <ToolOutput
                                      output={JSON.stringify(tool.output, null, 2)}
                                      errorText={tool.state === 'failed' ? 'Tool execution failed' : undefined}
                                    />
                                  </ToolContent>
                                </Tool>
                              ))}
                            </TaskContent>
                          </Task>
                        ))}
                      </div>
                    )}

                    {/* 推理过程展示 */}
                    {(reasoning || generating) && (
                      <Reasoning isStreaming={generating && !generatedReport}>
                        <ReasoningTrigger />
                        <ReasoningContent>{reasoning}</ReasoningContent>
                      </Reasoning>
                    )}

                    {generatedReport && (
                      <div className="prose prose-sm dark:prose-invert max-w-none mt-4">
                        <ReactMarkdown>{generatedReport}</ReactMarkdown>
                        {generating && <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />}
                      </div>
                    )}
                  </ScrollArea>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                    {generating ? (
                      <>
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p>正在思考并撰写周报...</p>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-12 w-12 opacity-20" />
                        <p>准备好数据后，点击生成按钮</p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
