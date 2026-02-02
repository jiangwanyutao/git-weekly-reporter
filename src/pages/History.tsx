
import { useAppStore } from '@/store';
import { Report } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, FileText, Calendar, Copy, Check, Download, GitBranch, GitCommit, Layers } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils"

export default function HistoryPage() {
  const { reports, deleteReport } = useAppStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const handleDelete = (id: string) => {
    deleteReport(id);
    if (selectedId === id) {
      setSelectedId(null);
    }
    toast({ title: "已删除", description: "周报记录已移除" });
  };

  const handleCopy = async (report: Report) => {
    try {
      const parts = [];
      parts.push(`周报日期: ${report.dateRange.start} ~ ${report.dateRange.end}`);
      if (report.totalCommits !== undefined) parts.push(`提交总数: ${report.totalCommits}`);
      if (report.projects && report.projects.length > 0) parts.push(`涉及项目: ${report.projects.join(', ')}`);
      if (report.branches && report.branches.length > 0) parts.push(`涉及分支: ${report.branches.join(', ')}`);
      parts.push('');

      // Remove markdown syntax
      const plainContent = report.content
        .replace(/^#+\s+/gm, '') // Remove headers
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
        .replace(/\*(.*?)\*/g, '$1') // Remove italic
        .replace(/`{3}[\s\S]*?`{3}/g, (match) => match.replace(/`{3}/g, '')) // Remove code blocks but keep content
        .replace(/`([^`]+)`/g, '$1') // Remove inline code
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove links
        .replace(/^>\s+/gm, '') // Remove blockquotes
        .replace(/^\s*[-*+]\s+/gm, '• ') // Replace list items with bullet points
        .replace(/^\d+\.\s+/gm, (match) => match); // Keep numbered lists

      parts.push(plainContent);

      const fullContent = parts.join('\n');

      await navigator.clipboard.writeText(fullContent);
      setCopiedId(report.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: "复制成功", description: "周报内容(纯文本)及元数据已复制到剪贴板" });
    } catch (err) {
      toast({ title: "复制失败", description: "无法访问剪贴板", variant: "destructive" });
    }
  };

  const handleExportAll = async () => {
    if (filteredReports.length === 0) {
      toast({ title: "导出失败", description: "当前没有可导出的周报", variant: "destructive" });
      return;
    }
    try {
      const suggestedName = `周报导出_${dayjs().format('YYYYMMDD_HHmm')}.json`;
      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (path) {
        await writeTextFile(path, JSON.stringify(filteredReports, null, 2));
        toast({ title: "导出成功", description: `已导出 ${filteredReports.length} 份周报` });
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast({ title: "导出失败", description: "保存文件时出错", variant: "destructive" });
    }
  };

  // 过滤逻辑
  const filteredReports = useMemo(() => {
    return reports.filter(report => {
      // 1. 搜索过滤
      const matchesSearch = searchQuery
        ? report.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        dayjs(report.createdAt).format('YYYY-MM-DD').includes(searchQuery)
        : true;

      // 2. 日期范围过滤 (基于生成时间)
      let matchesDate = true;
      if (dateRange?.from) {
        const reportDate = dayjs(report.createdAt);
        const fromDate = dayjs(dateRange.from).startOf('day');
        const toDate = dateRange.to ? dayjs(dateRange.to).endOf('day') : fromDate.endOf('day');

        matchesDate = reportDate.isAfter(fromDate) && reportDate.isBefore(toDate);
      }

      return matchesSearch && matchesDate;
    }).sort((a, b) => b.createdAt - a.createdAt); // 默认按时间倒序
  }, [reports, searchQuery, dateRange]);

  const selectedReport = useMemo(() =>
    reports.find(r => r.id === selectedId) || filteredReports[0] || null,
    [reports, selectedId, filteredReports]);

  return (
    <div className="flex-1 p-4 h-full flex overflow-hidden gap-4">
      {/* 左侧列表面板 */}
      <div className="w-[320px] shrink-0 flex flex-col border rounded-lg bg-background overflow-hidden">
        <div className="p-4 space-y-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">历史周报</h1>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{filteredReports.length} 份</Badge>
              <Button variant="outline" size="icon" className="h-6 w-6" onClick={handleExportAll} title="导出当前列表">
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Input
              placeholder="搜索周报内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8"
            />
            <div className="flex">
              <DatePickerWithRange
                className="w-full [&>button]:w-full"
                date={dateRange}
                setDate={setDateRange}
              />
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2 p-4">
            {filteredReports.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">
                没有找到相关周报
              </div>
            ) : (
              filteredReports.map((report) => (
                <button
                  key={report.id}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent hover:text-accent-foreground group",
                    selectedReport?.id === report.id ? "bg-accent text-accent-foreground" : "bg-card"
                  )}
                  onClick={() => setSelectedId(report.id)}
                >
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold">
                          {dayjs(report.createdAt).format('YYYY年MM月DD日')}
                        </div>
                        {!report.status && <span className="flex h-2 w-2 rounded-full bg-blue-600" />}
                      </div>
                      <div className={cn("ml-auto text-xs group-hover:text-accent-foreground", selectedReport?.id === report.id ? "text-accent-foreground" : "text-muted-foreground")}>
                        {dayjs(report.createdAt).fromNow()}
                      </div>
                    </div>
                    <div className={cn("text-xs font-medium group-hover:text-accent-foreground", selectedReport?.id === report.id ? "text-accent-foreground" : "text-muted-foreground")}>
                      范围: {dayjs(report.dateRange.start).format('MM/DD')} - {dayjs(report.dateRange.end).format('MM/DD')}
                    </div>
                  </div>
                  <div className={cn("line-clamp-2 text-xs w-full group-hover:text-accent-foreground", selectedReport?.id === report.id ? "text-accent-foreground" : "text-muted-foreground")}>
                    {report.content.substring(0, 100)}...
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="outline" className={cn("text-[10px] px-1 py-0 transition-colors group-hover:text-accent-foreground", selectedReport?.id === report.id ? "text-accent-foreground border-accent-foreground/30" : "text-muted-foreground")}>
                      {report.content.length} 字
                    </Badge>
                    {report.totalCommits !== undefined && (
                      <Badge variant="outline" className={cn("text-[10px] px-1 py-0 gap-1 transition-colors group-hover:text-accent-foreground", selectedReport?.id === report.id ? "text-accent-foreground border-accent-foreground/30" : "text-muted-foreground")}>
                        <GitCommit className="h-3 w-3" />
                        {report.totalCommits}
                      </Badge>
                    )}
                    {report.branches && report.branches.length > 0 && (
                      <Badge variant="outline" className={cn("text-[10px] px-1 py-0 gap-1 transition-colors group-hover:text-accent-foreground", selectedReport?.id === report.id ? "text-accent-foreground border-accent-foreground/30" : "text-muted-foreground")}>
                        <GitBranch className="h-3 w-3" />
                        {report.branches.length > 1 ? `${report.branches.length} 分支` : report.branches[0]}
                      </Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 右侧详情面板 */}
      <div className="flex-1 flex flex-col min-w-0 border rounded-lg bg-background overflow-hidden">
        {selectedReport ? (
          <div className="h-full flex flex-col">
            <div className="flex flex-col gap-4 p-4 border-b shrink-0">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  周报详情
                </h2>
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {dayjs(selectedReport.createdAt).format('YYYY-MM-DD HH:mm')}
                  </span>
                  <span>
                    覆盖: {dayjs(selectedReport.dateRange.start).format('MM-DD')} ~ {dayjs(selectedReport.dateRange.end).format('MM-DD')}
                  </span>
                  {selectedReport.totalCommits !== undefined && (
                    <span className="flex items-center gap-1">
                      <GitCommit className="h-3.5 w-3.5" />
                      {selectedReport.totalCommits} commits
                    </span>
                  )}
                  {selectedReport.projects && selectedReport.projects.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5" />
                      {selectedReport.projects.length} projects
                    </span>
                  )}
                </div>
                {selectedReport.branches && selectedReport.branches.length > 0 && (
                  <div className="text-xs text-muted-foreground flex items-start gap-1">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="break-all">
                      {selectedReport.branches.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(selectedReport)}
              >
                {copiedId === selectedReport.id ? (
                  <Check className="mr-2 h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                复制
              </Button>
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive/90"
                onClick={() => handleDelete(selectedReport.id)}
                title="删除"
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="prose prose-sm dark:prose-invert max-w-none p-6">
                <ReactMarkdown>{selectedReport.content}</ReactMarkdown>
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <FileText className="h-16 w-16 opacity-20" />
            <p>请选择一份周报查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
