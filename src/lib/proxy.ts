import type { AppSettings } from '@/types';

// Clash Verge 默认端口
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7897';

type ProxySettings = Pick<AppSettings, 'proxyEnabled' | 'proxyUrl'>;

// 归一化代理地址：留空返回 undefined；无协议则补 http://
export function normalizeProxyUrl(raw?: string): string | undefined {
  const v = (raw || '').trim();
  if (!v) return undefined;
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}

// 当前生效的代理；开关关闭时不指定代理，由系统网络设置决定（系统代理、环境变量代理会生效）
export function activeProxy(s: ProxySettings): string | undefined {
  return s.proxyEnabled ? normalizeProxyUrl(s.proxyUrl) ?? DEFAULT_PROXY_URL : undefined;
}

// 检查更新的线路顺序：先按当前设置走，失败后换另一条（不指定代理 ↔ 指定代理）再试一次。undefined 表示不指定代理
export function updateCheckRoutes(s: ProxySettings): (string | undefined)[] {
  const proxy = normalizeProxyUrl(s.proxyUrl) ?? DEFAULT_PROXY_URL;
  return s.proxyEnabled ? [proxy, undefined] : [undefined, proxy];
}

// 下载更新包的线路顺序：先走检测时已经连通的线路，失败再换另一条
export function downloadRoutes(s: ProxySettings, succeeded: string | undefined): (string | undefined)[] {
  return [succeeded, ...updateCheckRoutes(s).filter((r) => r !== succeeded)];
}

// 依次按线路尝试，任一成功即返回；全部失败时把每条线路的原因拼进错误信息
export async function withRouteFallback<T>(
  routes: (string | undefined)[],
  attempt: (proxy: string | undefined) => Promise<T>
): Promise<T> {
  const failures: string[] = [];
  for (const proxy of routes) {
    try {
      return await attempt(proxy);
    } catch (error: any) {
      const reason = error?.message || String(error);
      const label = proxy ? `代理 ${proxy}` : '不指定代理';
      console.warn(`[proxy] ${label} 失败:`, reason);
      failures.push(`${label}：${reason}`);
    }
  }
  throw new Error(failures.join('；'));
}

// 旧版是 notionProxyUrl / updaterProxyUrl 两个独立地址，合并成一个开关 + 地址。
// 填过地址的老用户升级后保持开启，避免原本能用的代理突然失效。
export function migrateProxySettings<T extends Record<string, any>>(raw: T): Record<string, any> {
  const { notionProxyUrl, updaterProxyUrl, ...rest } = raw;
  if (typeof rest.proxyEnabled === 'boolean') return rest;
  const legacy = normalizeProxyUrl(notionProxyUrl) ?? normalizeProxyUrl(updaterProxyUrl);
  return { ...rest, proxyEnabled: Boolean(legacy), proxyUrl: legacy ?? DEFAULT_PROXY_URL };
}
