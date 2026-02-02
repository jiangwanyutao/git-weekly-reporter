import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, FileText, Calendar, Copy, Check, Download, Search, Inbox, Clock } from 'lucide-react';
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
    toast({ title: "Deleted", description: "Report has been removed" });
  };

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: "Copied", description: "Content copied to clipboard" });
    } catch (err) {
      toast({ title: "Copy failed", description: "Cannot access clipboard", variant: "destructive" });
    }
  };

  const handleExportAll = async () => {
    if (filteredReports.length === 0) {
      toast({ title: "Export failed", description: "No reports to export", variant: "destructive" });
      return;
    }
    try {
      const suggestedName = `reports_export_${dayjs().format('YYYYMMDD_HHmm')}.json`;
      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (path) {
        await writeTextFile(path, JSON.stringify(filteredReports, null, 2));
        toast({ title: "Exported", description: `Exported ${filteredReports.length} reports` });
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast({ title: "Export failed", description: "Error saving file", variant: "destructive" });
    }
  };

  const filteredReports = useMemo(() => {
    return reports.filter(report => {
      const matchesSearch = searchQuery
        ? report.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        dayjs(report.createdAt).format('YYYY-MM-DD').includes(searchQuery)
        : true;

      let matchesDate = true;
      if (dateRange?.from) {
        const reportDate = dayjs(report.createdAt);
        const fromDate = dayjs(dateRange.from).startOf('day');
        const toDate = dateRange.to ? dayjs(dateRange.to).endOf('day') : fromDate.endOf('day');
        matchesDate = reportDate.isAfter(fromDate) && reportDate.isBefore(toDate);
      }

      return matchesSearch && matchesDate;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [reports, searchQuery, dateRange]);

  const selectedReport = useMemo(() =>
    reports.find(r => r.id === selectedId) || filteredReports[0] || null,
    [reports, selectedId, filteredReports]);

  return (
    <div className="flex-1 h-full flex overflow-hidden">
      {/* Left: Report List */}
      <div className="w-[340px] shrink-0 flex flex-col border-r border-border/50 bg-card/30">
        {/* Header */}
        <div className="shrink-0 p-4 space-y-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <h1 className="font-semibold">History</h1>
              <Badge variant="secondary" className="h-5 text-[10px]">
                {filteredReports.length}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleExportAll}
              title="Export all"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-background/50 border-border/50"
            />
          </div>

          {/* Date Filter */}
          <DatePickerWithRange
            className="w-full [&>button]:w-full [&>button]:justify-start [&>button]:h-9 [&>button]:bg-background/50"
            date={dateRange}
            setDate={setDateRange}
          />
        </div>

        {/* Report List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filteredReports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FileText className="h-10 w-10 opacity-20 mb-3" />
                <p className="text-sm">No reports found</p>
              </div>
            ) : (
              filteredReports.map((report) => {
                const isSelected = selectedReport?.id === report.id;
                return (
                  <button
                    key={report.id}
                    className={cn(
                      "w-full flex flex-col gap-2 rounded-lg p-3 text-left transition-all",
                      "hover:bg-accent/50",
                      isSelected
                        ? "bg-primary/10 border border-primary/20"
                        : "border border-transparent"
                    )}
                    onClick={() => setSelectedId(report.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                          isSelected ? "bg-primary/20" : "bg-muted/50"
                        )}>
                          <FileText className={cn(
                            "h-4 w-4",
                            isSelected ? "text-primary" : "text-muted-foreground"
                          )} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {dayjs(report.createdAt).format('MMM D, YYYY')}
                          </p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {dayjs(report.createdAt).fromNow()}
                          </p>
                        </div>
                      </div>
                      {!report.status && (
                        <span className="flex h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 pl-10">
                      {report.content.substring(0, 100)}...
                    </p>

                    <div className="flex items-center gap-2 pl-10">
                      <Badge variant="outline" className="h-5 text-[9px] px-1.5 border-border/50">
                        {report.dateRange.start} ~ {report.dateRange.end}
                      </Badge>
                      <Badge variant="secondary" className="h-5 text-[9px] px-1.5">
                        {report.content.length} chars
                      </Badge>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Report Detail */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/50">
        {selectedReport ? (
          <>
            {/* Detail Header */}
            <div className="shrink-0 px-6 py-4 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Report Details
                  </h2>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Generated {dayjs(selectedReport.createdAt).format('YYYY-MM-DD HH:mm')}
                    </span>
                    <span>
                      Coverage: {dayjs(selectedReport.dateRange.start).format('MMM D')} - {dayjs(selectedReport.dateRange.end).format('MMM D, YYYY')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(selectedReport.content, selectedReport.id)}
                    className="h-8"
                  >
                    {copiedId === selectedReport.id ? (
                      <>
                        <Check className="h-4 w-4 mr-1.5 text-primary" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1.5" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Separator orientation="vertical" className="h-6" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(selectedReport.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Detail Content */}
            <ScrollArea className="flex-1">
              <div className="p-6">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-li:text-muted-foreground prose-code:text-primary prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                  <ReactMarkdown>{selectedReport.content}</ReactMarkdown>
                </div>
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <div className="p-4 rounded-full bg-muted/30 mb-4">
              <FileText className="h-8 w-8 opacity-30" />
            </div>
            <p className="text-sm font-medium">Select a report</p>
            <p className="text-xs mt-1">Choose from the list to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
