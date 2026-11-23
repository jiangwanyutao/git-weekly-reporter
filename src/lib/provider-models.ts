import type { ModelProvider } from '../types/index.ts';
import { buildProviderHeaders, resolveProviderAddress, validateProvider } from './provider-config.ts';
import { requestModel } from './model-http.ts';

export interface ProviderModel { id: string; name: string }

export function buildModelsEndpoint(provider: ModelProvider): string {
  const address = resolveProviderAddress(provider);
  const url = new URL(address.baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const base = path.replace(/\/(?:chat\/completions|responses|messages|models\/[^/]+:(?:streamGenerateContent|generateContent))$/, '');
  if (url.origin === 'https://opencode.ai' && path.startsWith('/inference/go/')) {
    url.pathname = '/inference/go/v1/models';
  } else {
    if (address.endpointMode === 'full' && base === path && !/\/(?:v\d+(?:beta\d*)?|models)$/.test(path) && path !== '') {
      throw new Error('无法从这个完整请求地址推导模型列表接口，请改用供应商的基础地址，或手动填写模型 ID');
    }
    url.pathname = base.endsWith('/models') ? base : base + '/models';
  }
  url.searchParams.delete('alt');
  return url.toString();
}

export async function fetchProviderModels(provider: ModelProvider, signal?: AbortSignal, proxyUrl?: string): Promise<ProviderModel[]> {
  validateProvider(provider, true, false);
  const url = new URL(buildModelsEndpoint(provider));
  const headers = buildProviderHeaders(provider, crypto.randomUUID(), false);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('拉取模型超时，请重试或手动填写模型 ID')), 30_000);
  const models = new Map<string, ProviderModel>();
  const cursors = new Set<string>();
  try {
    for (let page = 0; page < 20; page++) {
      const response = await requestModel(url.toString(), provider.apiKey, {}, controller.signal, headers, 'GET', proxyUrl);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const hint = response.status === 401 || response.status === 403 ? '请检查密钥和账户权限'
          : response.status === 404 || response.status === 405 ? '该地址不提供模型列表，请核对基础地址，或手动填写模型 ID'
          : '请稍后重试或手动填写模型 ID';
        throw new Error(`拉取模型失败 (HTTP ${response.status})：${hint}。GET ${url.origin}${url.pathname}`);
      }
      let payload: any;
      try { payload = await response.json(); }
      catch { controller.signal.throwIfAborted(); throw new Error('模型列表接口未返回有效 JSON，请核对基础地址'); }
      const items = provider.protocol === 'gemini' ? payload?.models : payload?.data;
      if (!Array.isArray(items)) throw new Error('返回内容不是模型列表，请核对地址与接口协议');
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (provider.protocol === 'gemini' && Array.isArray(item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes('generateContent')) continue;
        const rawId = provider.protocol === 'gemini' ? item.name : item.id;
        if (typeof rawId !== 'string' || !rawId.trim()) continue;
        const id = provider.protocol === 'gemini' ? rawId.replace(/^models\//, '') : rawId;
        const display = item.displayName ?? item.display_name ?? item.name;
        models.set(id, { id, name: typeof display === 'string' && display.trim() ? display : id });
      }
      const cursor = provider.protocol === 'gemini' ? payload.nextPageToken
        : provider.protocol === 'anthropic' && payload.has_more ? payload.last_id : undefined;
      if (provider.protocol === 'anthropic' && payload.has_more && !cursor) throw new Error('模型列表分页信息不完整，请重试或手动填写模型 ID');
      if (!cursor) return [...models.values()];
      if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('模型列表分页异常，请重试或手动填写模型 ID');
      cursors.add(cursor);
      url.searchParams.set(provider.protocol === 'gemini' ? 'pageToken' : 'after_id', cursor);
    }
    throw new Error('模型列表页数过多，请手动填写模型 ID');
  } catch (error) {
    controller.signal.throwIfAborted();
    // 网络层错误可能携带含 Key 的 URL，只展示受控信息。
    if (error instanceof TypeError) throw new Error('无法连接模型列表接口，请检查地址和网络');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
