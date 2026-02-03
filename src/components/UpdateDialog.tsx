import { useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { Download, RefreshCcw, CheckCircle2, XCircle } from 'lucide-react';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  status: UpdateStatus;
  update: Update | null;
  progress: number;
  downloadedSize: number;
  totalSize: number;
  error: string | null;
}

export function useUpdateDialog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    update: null,
    progress: 0,
    downloadedSize: 0,
    totalSize: 0,
    error: null,
  });

  const checkForUpdate = async () => {
    setOpen(true);
    setState(prev => ({ ...prev, status: 'checking', error: null }));

    try {
      const update = await check();
      if (update) {
        setState(prev => ({ ...prev, status: 'available', update }));
      } else {
        setState(prev => ({ ...prev, status: 'idle' }));
        toast({ title: '检查更新', description: '当前已是最新版本' });
        setOpen(false);
      }
    } catch (error: any) {
      console.error(error);
      setState(prev => ({ 
        ...prev, 
        status: 'error', 
        error: error.message || '检查更新失败' 
      }));
    }
  };

  const startDownload = async () => {
    if (!state.update) return;

    setState(prev => ({ ...prev, status: 'downloading', progress: 0 }));

    try {
      await state.update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            setState(prev => ({ 
              ...prev, 
              totalSize: event.data.contentLength || 0 
            }));
            break;
          case 'Progress':
            setState(prev => {
              const downloaded = prev.downloadedSize + event.data.chunkLength;
              const progress = prev.totalSize > 0 
                ? Math.round((downloaded / prev.totalSize) * 100) 
                : 0;
              return {
                ...prev,
                downloadedSize: downloaded,
                progress,
              };
            });
            break;
          case 'Finished':
            setState(prev => ({ ...prev, status: 'ready', progress: 100 }));
            break;
        }
      });
      
      setState(prev => ({ ...prev, status: 'ready', progress: 100 }));
    } catch (error: any) {
      console.error(error);
      setState(prev => ({ 
        ...prev, 
        status: 'error', 
        error: error.message || '下载更新失败' 
      }));
    }
  };

  const handleRelaunch = async () => {
    try {
      await relaunch();
    } catch (error) {
      console.error(error);
      toast({ 
        title: '重启失败', 
        description: '请手动关闭并重新打开应用',
        variant: 'destructive'
      });
    }
  };

  const closeDialog = () => {
    if (state.status !== 'downloading') {
      setOpen(false);
      setState({
        status: 'idle',
        update: null,
        progress: 0,
        downloadedSize: 0,
        totalSize: 0,
        error: null,
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const UpdateDialogComponent = () => (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.status === 'checking' && (
              <>
                <RefreshCcw className="h-5 w-5 animate-spin" />
                检查更新中...
              </>
            )}
            {state.status === 'available' && (
              <>
                <Download className="h-5 w-5" />
                发现新版本
              </>
            )}
            {state.status === 'downloading' && (
              <>
                <Download className="h-5 w-5 animate-pulse" />
                正在下载更新
              </>
            )}
            {state.status === 'ready' && (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                更新已就绪
              </>
            )}
            {state.status === 'error' && (
              <>
                <XCircle className="h-5 w-5 text-destructive" />
                更新失败
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {state.status === 'checking' && '正在检查是否有新版本...'}
            {state.status === 'available' && state.update && (
              <div className="space-y-2 mt-2">
                <p><strong>版本:</strong> {state.update.version}</p>
                {state.update.body && (
                  <div>
                    <strong>更新内容:</strong>
                    <p className="mt-1 text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {state.update.body}
                    </p>
                  </div>
                )}
              </div>
            )}
            {state.status === 'downloading' && (
              <div className="space-y-3 mt-3">
                <Progress value={state.progress} className="h-2" />
                <div className="flex justify-between text-sm">
                  <span>{state.progress}%</span>
                  <span>
                    {formatBytes(state.downloadedSize)} / {formatBytes(state.totalSize)}
                  </span>
                </div>
              </div>
            )}
            {state.status === 'ready' && '更新已下载完成，点击下方按钮重启应用以完成安装。'}
            {state.status === 'error' && (
              <p className="text-destructive">{state.error}</p>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          {state.status === 'available' && (
            <>
              <Button variant="outline" onClick={closeDialog}>
                稍后再说
              </Button>
              <Button onClick={startDownload}>
                <Download className="h-4 w-4 mr-2" />
                立即更新
              </Button>
            </>
          )}
          {state.status === 'ready' && (
            <Button onClick={handleRelaunch}>
              <RefreshCcw className="h-4 w-4 mr-2" />
              重启应用
            </Button>
          )}
          {state.status === 'error' && (
            <Button variant="outline" onClick={closeDialog}>
              关闭
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return {
    checkForUpdate,
    UpdateDialog: UpdateDialogComponent,
  };
}
