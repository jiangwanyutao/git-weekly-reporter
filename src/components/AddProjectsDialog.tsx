import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '@/store';
import type { Project } from '@/types';
import { basename, planImport, type ImportCandidate } from '@/lib/project-import';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Options = {
  // 只添加了一个项目时回调（设置页用它弹出改别名的弹窗）；批量导入不回调，避免连弹多个
  onSingleAdded?: (project: Project) => void;
};

function addOne(path: string): Project | undefined {
  useAppStore.getState().addProject(path);
  return useAppStore.getState().projects.find((p) => p.path === path);
}

// 侧栏和设置页共用的「添加项目」：选一个文件夹，本身是仓库就直接加；
// 否则扫描下一层子文件夹里的 Git 仓库，多个时弹窗勾选后批量导入
export function useAddProjects({ onSingleAdded }: Options = {}) {
  const [scanning, setScanning] = useState(false);
  const [folder, setFolder] = useState('');
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const addProjects = async () => {
    try {
      if (!isTauri) {
        const mockPath = `C:\\Mock\\Project\\${Math.floor(Math.random() * 1000)}`;
        addOne(mockPath);
        toast({ title: 'Mock项目已添加', description: mockPath });
        return;
      }
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== 'string') return;

      setScanning(true);
      const found = await invoke<string[]>('scan_git_repos', { path: selected });
      const plan = planImport(found, useAppStore.getState().projects.map((p) => p.path));

      if (plan.length === 0) {
        toast({ title: '没有找到 Git 仓库', description: '该文件夹及其下一层子文件夹中都没有 Git 仓库', variant: 'destructive' });
        return;
      }
      if (plan.length === 1) {
        const [only] = plan;
        if (only.added) {
          toast({ title: '项目已存在', description: only.path });
          return;
        }
        const project = addOne(only.path);
        toast({ title: '项目已添加', description: only.path });
        if (project) onSingleAdded?.(project);
        return;
      }
      setFolder(selected);
      setCandidates(plan);
      setChecked(new Set(plan.filter((c) => !c.added).map((c) => c.path)));
    } catch (err: any) {
      console.error(err);
      toast({ title: '添加失败', description: err?.message || String(err) || '无法添加项目', variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const toggle = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const confirmImport = () => {
    if (!candidates) return;
    let imported = 0;
    const failures: string[] = [];
    for (const path of checked) {
      try {
        addOne(path);
        imported++;
      } catch (err: any) {
        failures.push(`${basename(path)}：${err?.message || err}`);
      }
    }
    const skipped = candidates.length - checked.size;
    const details = [skipped > 0 && `跳过 ${skipped} 个`, failures.length > 0 && `失败 ${failures.join('；')}`].filter(Boolean).join('，');
    toast({
      title: `已导入 ${imported} 个项目`,
      description: details || undefined,
      variant: failures.length > 0 ? 'destructive' : undefined,
    });
    setCandidates(null);
  };

  const importable = candidates?.filter((c) => !c.added) ?? [];
  const allChecked = importable.length > 0 && importable.every((c) => checked.has(c.path));

  const dialog = (
    <Dialog open={Boolean(candidates)} onOpenChange={(o) => !o && setCandidates(null)}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>发现 {candidates?.length ?? 0} 个 Git 仓库</DialogTitle>
          <DialogDescription className="break-all">来自 {folder}，勾选要导入的项目</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto rounded-[7px] border border-border">
          {candidates?.map((c) => (
            <label
              key={c.path}
              className={cn(
                'flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-0',
                c.added ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/60'
              )}
            >
              <Checkbox checked={c.added || checked.has(c.path)} disabled={c.added} onCheckedChange={() => toggle(c.path)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{c.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{c.path}</div>
              </div>
              {c.added && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">已添加</span>}
            </label>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={importable.length === 0}
            onClick={() => setChecked(allChecked ? new Set() : new Set(importable.map((c) => c.path)))}
          >
            {allChecked ? '全不选' : '全选'}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCandidates(null)}>
              取消
            </Button>
            <Button onClick={confirmImport} disabled={checked.size === 0}>
              导入 {checked.size} 个项目
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { addProjects, scanning, addProjectsDialog: dialog };
}
