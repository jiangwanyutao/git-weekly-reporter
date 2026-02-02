import { useEffect, useState, useRef, useMemo } from 'react';
import { useAppStore } from '@/store';
import { fetchGitLogs, getProjectContext, getProjectAuthors } from '@/lib/git';
import { generateWeeklyReport } from '@/lib/glm';
import { CommitLog, Report } from '@/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Sparkles, StopCircle, CheckCircle2, Circle, GitCommit, Calendar, Zap } from 'lucide-react';
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from '@/lib/utils';

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
  const { projects, settings, addReport, updateSettings } = useAppStore();
  const [logs, setLogs] = useState<CommitLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string>('');
  const [reasoning, setReasoning] = useState<string>('');
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: dayjs().day(5).subtract(1, 'week').toDate(),
    to: dayjs().day(5).toDate(),
  });

  useEffect(() => {
    const loadAuthors = async () => {
      const allAuthors = new Set<string>();
      for (const p of projects) {
        const projAuthors = await getProjectAuthors(p.path);
        projAuthors.forEach(a => allAuthors.add(a));
      }
      setAuthors(Array.from(allAuthors));
    };
    if (projects.length > 0) loadAuthors();
  }, [projects]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const loadLogs = async () => {
    if (projects.length === 0) return;
    setLoading(true);
    try {
      const allLogs: CommitLog[] = [];
      const since = dateRange?.from ? dayjs(dateRange.from).format('YYYY-MM-DD HH:mm:ss') : undefined;
      const until = dateRange?.to ? dayjs(dateRange.to).endOf('day').format('YYYY-MM-DD HH:mm:ss') : undefined;

      for (const project of projects) {
        const projectLogs = await fetchGitLogs(project.path, settings.authorName, since, until);
        allLogs.push(...projectLogs);
      }
      allLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setLogs(allLogs);
      toast({ title: "Refreshed", description: `Found ${allLogs.length} commits` });
    } catch (error) {
      console.error(error);
      toast({ title: "Failed", description: "Please check Git path or permissions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (logs.length === 0) {
      toast({ title: "Cannot generate", description: "No commits found", variant: "destructive" });
      return;
    }
    if (!settings.glmApiKey) {
      toast({ title: "API Key not set", description: "Please configure API Key in Settings", variant: "destructive" });
      return;
    }

    setGenerating(true);
    setAgentSteps([]);
    setGeneratedReport('');
    setReasoning('');
    abortControllerRef.current = new AbortController();

    try {
      setAgentSteps(prev => [...prev, {
        id: 'intent',
        type: 'task',
        title: 'Intent Recognition',
        status: 'completed',
        details: 'User Request: Generate Weekly Report',
        tools: []
      }]);

      const analysisStepId = 'analysis';
      setAgentSteps(prev => [...prev, {
        id: analysisStepId,
        type: 'task',
        title: 'Project Analysis',
        status: 'running',
        details: 'Analyzing project structure...',
        tools: []
      }]);

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

      const gitStepId = 'git-history';
      setAgentSteps(prev => [...prev, {
        id: gitStepId,
        type: 'task',
        title: 'Commit History Analysis',
        status: 'running',
        details: `Processing ${logs.length} commits...`,
        tools: []
      }]);

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

      const genStepId = 'generation';
      setAgentSteps(prev => [...prev, {
        id: genStepId,
        type: 'task',
        title: 'Report Generation',
        status: 'running',
        details: 'Streaming from AI...',
        tools: []
      }]);

      const reportContent = await generateWeeklyReport(
        settings.glmApiKey,
        settings.promptTemplate,
        commitsText,
        projectContext,
        (chunk) => setGeneratedReport(chunk),
        (chunk) => setReasoning(chunk),
        abortControllerRef.current.signal
      );

      setAgentSteps(prev => prev.map(s => s.id === genStepId ? { ...s, status: 'completed' } : s));
      setGeneratedReport(reportContent);

      const newReport: Report = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        dateRange: {
          start: dateRange?.from ? dayjs(dateRange.from).format('YYYY-MM-DD') : '',
          end: dateRange?.to ? dayjs(dateRange.to).format('YYYY-MM-DD') : '',
        },
        content: reportContent,
        status: 'generated',
      };
      addReport(newReport);
      toast({ title: "Report generated", description: "Saved to history" });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast({ title: "Generation cancelled", description: "Stopped by user" });
      } else {
        toast({ title: "Generation failed", description: error.message, variant: "destructive" });
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

  useEffect(() => {
    const state = useAppStore.getState();
    if (state.projects.length > 0) {
      loadLogs();
    }
  }, [projects, settings.authorName]);

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

  const formatDate = (date: Date | undefined) => {
    return date ? dayjs(date).format('MMM D, YYYY') : '...';
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 px-6 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Dashboard
            </h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{projects.length} projects</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              <Select
                value={settings.authorName || 'all'}
                onValueChange={(val) => {
                  updateSettings({ ...settings, authorName: val === 'all' ? '' : val });
                }}
              >
                <SelectTrigger className="h-7 w-[140px] text-xs border-0 bg-muted/50 hover:bg-muted">
                  <SelectValue placeholder="All authors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All authors</SelectItem>
                  {authors.map(a => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DatePickerWithRange date={dateRange} setDate={setDateRange} />

            <Button
              variant="outline"
              size="sm"
              onClick={loadLogs}
              disabled={loading || generating}
              className="h-9"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Refresh
            </Button>

            {generating ? (
              <Button variant="destructive" size="sm" onClick={handleStopGenerate} className="h-9">
                <StopCircle className="h-4 w-4 mr-2" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={logs.length === 0}
                className="h-9 bg-primary hover:bg-primary/90"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Generate
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-h-0 p-4">
        <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl overflow-hidden">
          {/* Left: Commits */}
          <ResizablePanel defaultSize={35} minSize={25}>
            <div className="h-full flex flex-col bg-card/50 rounded-l-xl border border-r-0 border-border/50">
              <div className="shrink-0 px-4 py-3 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitCommit className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium text-sm">Commits</h2>
                    <Badge variant="secondary" className="h-5 text-[10px] bg-muted">
                      {logs.length}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(dateRange?.from)} - {formatDate(dateRange?.to)}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-3 space-y-3">
                  {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <GitCommit className="h-10 w-10 opacity-20 mb-3" />
                      <p className="text-sm">No commits found</p>
                      <p className="text-xs mt-1">Check date range or refresh</p>
                    </div>
                  ) : (
                    Object.entries(groupedLogs).map(([project, projectLogs]) => (
                      <div key={project} className="rounded-lg border border-border/50 bg-background/50 overflow-hidden">
                        <div className="px-3 py-2 border-b border-border/50 bg-muted/30">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium truncate">{project}</span>
                            <Badge variant="outline" className="h-4 text-[9px] px-1.5">
                              {projectLogs.length}
                            </Badge>
                          </div>
                        </div>
                        <div className="divide-y divide-border/30 max-h-[240px] overflow-y-auto custom-scrollbar">
                          {projectLogs.map((log) => (
                            <div
                              key={log.hash}
                              className="px-3 py-2 hover:bg-accent/50 transition-colors group"
                            >
                              <p className="text-xs leading-relaxed group-hover:text-foreground transition-colors line-clamp-2">
                                {log.message}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {dayjs(log.date).format('MMM D, HH:mm')}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border/50 w-[1px]" />

          {/* Right: Preview */}
          <ResizablePanel defaultSize={65}>
            <div className="h-full flex flex-col bg-card/50 rounded-r-xl border border-l-0 border-border/50">
              <div className="shrink-0 px-4 py-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="font-medium text-sm">Report Preview</h2>
                  {generating && (
                    <Badge className="h-5 text-[10px] bg-primary/20 text-primary border-0 animate-pulse">
                      Generating...
                    </Badge>
                  )}
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4">
                  {generatedReport || reasoning || generating || agentSteps.length > 0 ? (
                    <div className="space-y-4">
                      {/* Agent Steps */}
                      {agentSteps.length > 0 && (
                        <div className="space-y-2">
                          {agentSteps.map(step => (
                            <Task key={step.id} defaultOpen={step.status === 'running' || step.status === 'failed'}>
                              <TaskTrigger title={step.title} className="w-full">
                                <div className="flex items-center gap-2 text-sm">
                                  {step.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                                  {step.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                                  {step.status === 'failed' && <Circle className="h-3.5 w-3.5 text-destructive" />}
                                  {step.status === 'pending' && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                                  <span>{step.title}</span>
                                </div>
                              </TaskTrigger>
                              <TaskContent>
                                {step.details && <p className="text-muted-foreground text-xs mb-2">{step.details}</p>}
                                {step.tools?.map(tool => (
                                  <Tool key={tool.id} className="mb-2">
                                    <ToolHeader type="function" toolName={tool.name} state={tool.state} />
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

                      {/* Reasoning */}
                      {(reasoning || generating) && (
                        <Reasoning isStreaming={generating && !generatedReport}>
                          <ReasoningTrigger />
                          <ReasoningContent>{reasoning}</ReasoningContent>
                        </Reasoning>
                      )}

                      {/* Report Content */}
                      {generatedReport && (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-li:text-muted-foreground">
                          <ReactMarkdown>{generatedReport}</ReactMarkdown>
                          {generating && <span className="inline-block w-2 h-5 ml-1 bg-primary animate-pulse rounded-sm" />}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-muted-foreground">
                      <div className="p-4 rounded-full bg-muted/30 mb-4">
                        <Sparkles className="h-8 w-8 opacity-30" />
                      </div>
                      <p className="text-sm font-medium">Ready to generate</p>
                      <p className="text-xs mt-1">Click Generate to create your weekly report</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
