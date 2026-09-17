import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import type { AppSettings } from '@/types';
import { downloadRoutes, updateCheckRoutes, withRouteFallback } from '@/lib/proxy';

type ProxySettings = Pick<AppSettings, 'proxyEnabled' | 'proxyUrl'>;

// 检测到的更新，连同检测时走通的线路一起记下，下载时优先复用这条线路
export interface FoundUpdate {
  update: Update;
  proxy: string | undefined;
}

const checkVia = (proxy: string | undefined) => check(proxy ? { proxy } : undefined);

// 检测更新：先按当前代理设置检测，失败后换另一条线路（不指定代理 ↔ 指定代理）再试。没有新版本返回 null
export async function findUpdate(settings: ProxySettings): Promise<FoundUpdate | null> {
  return withRouteFallback(updateCheckRoutes(settings), async (proxy) => {
    const update = await checkVia(proxy);
    return update ? { update, proxy } : null;
  });
}

// 下载并安装：先用检测时走通的线路下载；失败就换另一条线路重新检测一次再下载。
// 更新组件的下载会沿用检测时的代理，所以换线路必须重新检测拿到新的更新对象。
// 换线路后下载从头开始，onEvent 会再收到一次 Started。
export async function installUpdate(
  settings: ProxySettings,
  found: FoundUpdate,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  await withRouteFallback(downloadRoutes(settings, found.proxy), async (proxy) => {
    const update = proxy === found.proxy ? found.update : await checkVia(proxy);
    if (!update) throw new Error('这条线路没有检测到可用更新');
    await update.downloadAndInstall(onEvent);
  });
}
