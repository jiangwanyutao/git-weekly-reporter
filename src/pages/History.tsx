
import { useAppStore } from '@/store';
import { Report } from '@/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MagnifyingGlassIcon,
  DownloadSimpleIcon,
  CopyIcon,
  PaperPlaneTiltIcon,
  TrashIcon,
  ClockIcon,
  GitCommitIcon,
  GitBranchIcon,
  FolderIcon,
  CheckIcon,
  SpinnerIcon,
  FileTextIcon,
} from '@phosphor-icons/react';
import { toast } from '@/hooks/use-toast';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import dayjs from 'dayjs';
import { syncReportToNotion } from '@/lib/notion';

// dayjs 的插件与 locale 统一在 src/main.tsx 里初始化。
// 曾经放在这里，导致 import 本页就把全局 weekStart 改成周一，
// 把 Dashboard 的「本周一~本周五」算成了周二~周六。

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Input } from "@/components/ui/input"
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils"

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Scope = 'all' | 'month';

// 列表摘要：去掉标题行和 Markdown 标记，只留正文开头
function excerpt(content: string) {
  // 去掉标题行与「周报周期」抬头，只留正文
  return content.replace(/^(#.*|\**周报周期.*)$/gm, '').replace(/[*`>_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export default function HistoryPage() {
  const { reports, deleteReport, settings } = useAppStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scope, setScope] = useState<Scope>('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [syncingReportId, setSyncingReportId] = useState<string | null>(null);
  const exportTitle = isTauri ? "导出当前列表到本地文件" : "导出当前列表（浏览器下载）";

  const handleDelete = (id: string) => {
    if (!window.confirm('确定删除这份周报？删除后无法恢复。')) return;
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
      const payload = JSON.stringify(filteredReports, null, 2);

      if (!isTauri) {
        const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = suggestedName;
        anchor.click();
        URL.revokeObjectURL(url);
        toast({ title: "导出成功", description: `浏览器已下载 ${filteredReports.length} 份周报` });
        return;
      }

      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (path) {
        await writeTextFile(path, payload);
        toast({ title: "导出成功", description: `已保存 ${filteredReports.length} 份周报` });
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast({ title: "导出失败", description: "保存文件时出错", variant: "destructive" });
    }
  };

  const handleSyncToNotion = async (report: Report) => {
    if (syncingReportId) return;

    if (!settings.notionApiKey.trim() || !settings.notionParentPageId.trim()) {
      toast({
        title: "Notion 配置不完整",
        description: "请先在系统配置中填写 Notion Token 和目标页面后保存",
        variant: "destructive"
      });
      return;
    }

    setSyncingReportId(report.id);
    try {
      const result = await syncReportToNotion(report, settings);
      const syncDescription = settings.notionSyncMode === 'subpage'
        ? '周报已创建为 Notion 子页面'
        : '周报已追加到 Notion 文档正文';
      toast({
        title: "同步成功",
        description: result.url ? syncDescription : "周报已完成 Notion 同步",
      });
    } catch (error: any) {
      toast({
        title: "同步失败",
        description: error.message || "Notion 同步失败",
        variant: "destructive",
      });
    } finally {
      setSyncingReportId(null);
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

      // 2. 本月：按生成时间落在当前自然月
      const matchesScope = scope === 'month' ? dayjs(report.createdAt).isSame(dayjs(), 'month') : true;

      // 3. 日期范围过滤 (基于生成时间)
      let matchesDate = true;
      if (dateRange?.from) {
        const reportDate = dayjs(report.createdAt);
        const fromDate = dayjs(dateRange.from).startOf('day');
        const toDate = dateRange.to ? dayjs(dateRange.to).endOf('day') : fromDate.endOf('day');

        matchesDate = !reportDate.isBefore(fromDate) && !reportDate.isAfter(toDate);
      }

      return matchesSearch && matchesScope && matchesDate;
    }).sort((a, b) => b.createdAt - a.createdAt); // 默认按时间倒序
  }, [reports, searchQuery, scope, dateRange]);

  const selectedReport = useMemo(() =>
    reports.find(r => r.id === selectedId) || filteredReports[0] || null,
    [reports, selectedId, filteredReports]);

  const rangeLabel = (r: Report) => `${dayjs(r.dateRange.start).format('YYYY-MM-DD')} 至 ${dayjs(r.dateRange.end).format('MM-DD')}`;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-6 py-5">
      {/* 页头 */}
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">历史周报</h1>
          <p className="page-subtitle">共 {reports.length} 份 · 本地保存，可导出 JSON</p>
        </div>
        <Button variant="outline" onClick={handleExportAll} title={exportTitle}>
          <DownloadSimpleIcon size={16} />
          导出全部
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-4">
        {/* 左侧列表 */}
        <div className="flex min-h-0 flex-col rounded-[10px] border border-border bg-card shadow-sm">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3.5 py-3">
            <div className="relative">
              <MagnifyingGlassIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索周报内容…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex h-8 items-center rounded-md border border-border bg-muted p-[3px]">
                {(
                  [
                    ['all', '全部'],
                    ['month', '本月'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setScope(key)}
                    className={cn(
                      'h-full rounded-[5px] px-3 text-[13px] font-medium text-muted-foreground transition-colors',
                      scope === key && 'bg-card text-foreground shadow-sm'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <DatePickerWithRange
                date={dateRange}
                setDate={setDateRange}
                className="ml-auto min-w-0 [&_button]:h-8 [&_button]:px-2.5 [&_button]:text-xs"
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {filteredReports.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <FileTextIcon size={28} className="opacity-40" />
                <p className="text-sm">{reports.length === 0 ? '还没有生成过周报' : '没有找到相关周报'}</p>
              </div>
            ) : (
              filteredReports.map((report) => {
                const isSelected = selectedReport?.id === report.id;
                return (
                  <div
                    key={report.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'relative cursor-pointer border-b border-border px-3.5 py-3 transition-colors hover:bg-muted/60',
                      isSelected &&
                        'bg-accent hover:bg-accent before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[3px] before:rounded-r before:bg-primary'
                    )}
                    onClick={() => setSelectedId(report.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(report.id);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <b className="truncate text-[13px] font-semibold tabular-nums">{rangeLabel(report)}</b>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{dayjs(report.createdAt).fromNow()}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{excerpt(report.content)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {report.totalCommits !== undefined && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <GitCommitIcon size={11} /> {report.totalCommits}
                        </span>
                      )}
                      {report.projects && report.projects.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <FolderIcon size={11} /> {report.projects.length} 项目
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </ScrollArea>
        </div>

        {/* 右侧详情 */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-sm">
          {selectedReport ? (
            <>
              <div className="flex shrink-0 items-start gap-3 border-b border-border px-[18px] py-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold tabular-nums">{rangeLabel(selectedReport)} 周报</h2>
                  <div className="mt-1.5 flex flex-wrap gap-3.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ClockIcon size={13} /> 生成于 {dayjs(selectedReport.createdAt).format('MM-DD HH:mm')}
                    </span>
                    {selectedReport.totalCommits !== undefined && (
                      <span className="inline-flex items-center gap-1">
                        <GitCommitIcon size={13} /> {selectedReport.totalCommits} 提交
                      </span>
                    )}
                    {selectedReport.projects && selectedReport.projects.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <FolderIcon size={13} /> {selectedReport.projects.join('、')}
                      </span>
                    )}
                    {selectedReport.branches && selectedReport.branches.length > 0 && (
                      <span className="inline-flex items-center gap-1 break-all">
                        <GitBranchIcon size={13} className="shrink-0" /> {selectedReport.branches.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => handleCopy(selectedReport)}>
                    {copiedId === selectedReport.id ? <CheckIcon size={14} className="text-success" weight="bold" /> : <CopyIcon size={14} />}
                    复制
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    title="手动同步到 Notion"
                    disabled={!!syncingReportId}
                    onClick={() => void handleSyncToNotion(selectedReport)}
                  >
                    {syncingReportId === selectedReport.id ? <SpinnerIcon size={14} className="animate-spin" /> : <PaperPlaneTiltIcon size={14} />}
                    同步 Notion
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(selectedReport.id)}
                    title="删除"
                  >
                    <TrashIcon size={16} />
                  </Button>
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-7 py-5">
                  <div className="report-md">
                    <ReactMarkdown>{selectedReport.content}</ReactMarkdown>
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center text-muted-foreground">
              <FileTextIcon size={40} className="opacity-30" />
              <p className="text-sm">在左侧选择一份周报查看</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
