import type { ModelProvider, ProviderProtocol } from '../types/index.ts';

export const PROVIDER_PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI Chat Completions' },
  { value: 'responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'minimax', label: 'MiniMax' },
];

export const PROVIDER_PRESETS: { id: string; name: string; protocol: ProviderProtocol; baseUrl: string; customHeaders?: string }[] = [
  { id: 'custom', name: '自定义供应商', protocol: 'openai', baseUrl: '' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'responses', name: 'OpenAI Responses', protocol: 'responses', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', name: 'Google Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'ark', name: '火山方舟订阅', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3' },
  { id: 'opencode-go', name: 'OpenCode Go', protocol: 'openai', baseUrl: 'https://opencode.ai/inference/go/v1',
    customHeaders: JSON.stringify({ 'x-opencode-session': '{{sessionId}}' }, null, 2) },
];

export function createProvider(presetId = 'custom'): ModelProvider {
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error('未知供应商模板');
  return { ...preset, id: crypto.randomUUID(), model: '', apiKey: '', endpointMode: 'base', authMode: 'auto', builtin: false };
}

// 用户常粘贴 Go 订阅页；仅识别官方这一地址，不猜测其他供应商的 API 路径。
export function resolveProviderAddress(provider: ModelProvider): { baseUrl: string; endpointMode: 'base' | 'full' } {
  const baseUrl = provider.baseUrl.trim();
  const url = new URL(baseUrl);
  if (url.origin === 'https://opencode.ai' && url.pathname.replace(/\/+$/, '') === '/zen/go') {
    return { baseUrl: 'https://opencode.ai/inference/go/v1', endpointMode: 'base' };
  }
  return { baseUrl, endpointMode: provider.endpointMode ?? (provider.builtin ? 'base' : 'full') };
}

const blockedHeaders = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'set-cookie',
  'proxy-authorization', 'proxy-connection', 'origin', 'referer', 'accept-encoding', 'upgrade', 'te', 'trailer', 'expect']);
const protectedBodyKeys = new Set(['model', 'messages', 'input', 'contents', 'stream']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkKeys(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('配置包含不支持的对象字段');
    checkKeys(child);
  }
}

export function parseConfigObject(text: string | undefined, label: string): Record<string, unknown> {
  if (!text?.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${label}必须是有效的 JSON 对象`); }
  if (!isObject(value)) throw new Error(`${label}必须是 JSON 对象，不能是数组或其他值`);
  checkKeys(value);
  return value;
}

function customHeaders(provider: ModelProvider): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseConfigObject(provider.customHeaders, '自定义请求头'))) {
    const name = key.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || blockedHeaders.has(name) || name.startsWith('sec-') || name.startsWith('proxy-')) {
      throw new Error('请求头名称无效，或属于由 HTTP 客户端管理的字段');
    }
    if (Object.prototype.hasOwnProperty.call(result, name)) throw new Error('请求头名称重复（不区分大小写）');
    if (typeof value !== 'string' || /[^\t\x20-\x7e]/.test(value)) throw new Error('请求头值必须是单行 ASCII 字符串');
    if (/\{\{(?!apiKey\}\}|sessionId\}\})/.test(value)) throw new Error('请求头仅支持 {{apiKey}} 和 {{sessionId}} 占位符');
    if (name === 'content-type' && !/^application\/json(?:\s*;|$)/i.test(value)) throw new Error('模型请求的 Content-Type 必须为 application/json');
    result[name] = value;
  }
  return result;
}

function authHeader(provider: ModelProvider): string | undefined {
  if (provider.authMode === 'none') return undefined;
  if (provider.authMode === 'bearer') return 'authorization';
  if (provider.authMode === 'api-key') return provider.protocol === 'gemini' ? 'x-goog-api-key' : 'x-api-key';
  if (provider.protocol === 'anthropic') return 'x-api-key';
  if (provider.protocol === 'gemini') return 'x-goog-api-key';
  return 'authorization';
}

export function validateProvider(provider: ModelProvider, requireConnection = true, requireModel = true): void {
  if (!PROVIDER_PROTOCOLS.some((p) => p.value === provider.protocol)) throw new Error('不支持的模型接口协议');
  if (provider.endpointMode && !['base', 'full'].includes(provider.endpointMode)) throw new Error('接口地址模式无效');
  if (provider.authMode && !['auto', 'bearer', 'api-key', 'none'].includes(provider.authMode)) throw new Error('鉴权方式无效');
  if (provider.baseUrl?.trim()) {
    let url: URL;
    try { url = new URL(provider.baseUrl.trim()); } catch { throw new Error('接口地址不是有效的 URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('接口地址必须为 HTTP/HTTPS，不能包含用户密码或片段');
    }
  } else if (requireConnection) throw new Error('请填写接口地址');
  if (requireConnection && requireModel && !provider.model?.trim()) throw new Error('请填写模型名');
  if (/[\r\n]/.test(provider.apiKey ?? '')) throw new Error('API Key 不能包含换行');
  const headers = customHeaders(provider);
  const auth = authHeader(provider);
  if (requireConnection && !provider.apiKey?.trim()) {
    if ((auth && !headers[auth]?.trim()) || Object.values(headers).some((v) => v.includes('{{apiKey}}'))) {
      throw new Error('请填写 API Key，或选择无需鉴权并配置供应商要求的请求头');
    }
  }
  const body = parseConfigObject(provider.customBody, '额外请求参数');
  if (Object.keys(body).some((k) => protectedBodyKeys.has(k))) {
    throw new Error('额外参数不能覆盖 model、messages、input、contents 或 stream');
  }
}

export function buildProviderHeaders(provider: ModelProvider, sessionId: string, requireModel = true): Record<string, string> {
  validateProvider(provider, true, requireModel);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'AI-Weekly-Reporter' };
  const url = new URL(resolveProviderAddress(provider).baseUrl);
  if (url.origin === 'https://opencode.ai' && url.pathname.startsWith('/inference/go/')) headers['x-opencode-session'] = sessionId;
  const auth = authHeader(provider);
  if (auth && provider.apiKey.trim()) headers[auth] = (auth === 'authorization' ? 'Bearer ' : '') + provider.apiKey.trim();
  if (provider.protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  for (const [key, value] of Object.entries(customHeaders(provider))) {
    headers[key] = value.replace(/\{\{apiKey\}\}/g, () => provider.apiKey.trim()).replace(/\{\{sessionId\}\}/g, () => sessionId);
  }
  return headers;
}

export function applyCustomBody(provider: ModelProvider, body: Record<string, unknown>): Record<string, unknown> {
  validateProvider(provider);
  const merge = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete result[key];
      else result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value;
    }
    return result;
  };
  return merge(body, parseConfigObject(provider.customBody, '额外请求参数'));
}
