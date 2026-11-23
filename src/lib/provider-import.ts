import type { ModelProvider, ProviderProtocol } from '../types/index.ts';
import { createProvider, parseConfigObject, validateProvider } from './provider-config.ts';

const sdkProtocols: Record<string, ProviderProtocol> = {
  '@ai-sdk/openai-compatible': 'openai',
  '@ai-sdk/openai': 'responses',
  '@ai-sdk/anthropic': 'anthropic',
  '@ai-sdk/google': 'gemini',
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, fallback = ''): string {
  if (value === undefined) value = fallback;
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`);
  if (/\{env:|\{file:|\$\{/.test(value)) throw new Error(`${label}包含环境变量或文件引用，请先替换为实际值`);
  return value;
}

function jsonField(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? parseConfigObject(value, label) : object(value, label);
  const checkReferences = (item: unknown): void => {
    if (typeof item === 'string') string(item, label);
    else if (item && typeof item === 'object') Object.values(item).forEach(checkReferences);
  };
  checkReferences(parsed);
  return JSON.stringify(parsed, null, 2);
}

function importOne(raw: unknown, fallbackName: string): ModelProvider[] {
  const wrapper = object(raw, '供应商配置');
  if (wrapper.meta !== undefined) {
    const meta = object(wrapper.meta, 'meta');
    const requestSettings = ['apiFormat', 'isFullUrl', 'localProxyRequestOverrides', 'authBinding', 'apiKeyField',
      'customUserAgent', 'maxOutputTokens', 'providerType', 'codexCopilotApiFormat', 'codexFastMode',
      'codexChatReasoning', 'claudeReasoningEffort', 'impersonateClaudeCode', 'promptCacheKey', 'promptCacheRouting'];
    if (requestSettings.some((key) => key in meta)) {
      throw new Error('CC Switch 配置含代理或认证元数据，请通过表单设置协议、地址、认证与高级参数，避免导入时丢失请求设置');
    }
  }
  const config = wrapper.settingsConfig === undefined ? wrapper : object(wrapper.settingsConfig, 'settingsConfig');
  const name = string(wrapper.name ?? config.name, '供应商名称', fallbackName);
  if ('package' in config || 'settings' in config) throw new Error('暂不导入 OpenCode V2 配置，请通过表单设置协议、地址、请求头和参数');
  if ('config' in config && 'auth' in config) throw new Error('Codex TOML 配置不能直接导入，请通过表单填写 Responses 协议和接口信息');
  let providers: ModelProvider[];
  if ('npm' in config) {
    const npm = string(config.npm, 'SDK 包名');
    const protocol = sdkProtocols[npm];
    if (!protocol) throw new Error('该 SDK 不属于支持的四类协议，请手动配置兼容接口');
    const options = object(config.options ?? {}, 'options');
    if (Object.keys(options).some((key) => !['baseURL', 'apiKey', 'headers'].includes(key))) {
      throw new Error('options 含未支持的 SDK 设置，请先仅保留 baseURL、apiKey、headers，额外参数在表单中配置');
    }
    const models = Object.entries(object(config.models ?? {}, 'models'));
    const common = { ...createProvider(), name, protocol,
      baseUrl: string(options.baseURL, 'baseURL'), apiKey: string(options.apiKey, 'apiKey'),
      customHeaders: jsonField(options.headers, '请求头'),
    };
    providers = (models.length ? models : [['', {}] as [string, unknown]]).flatMap(([id, model]) => {
      const info = object(model, '模型配置');
      if (info.disabled === true) return [];
      if (['options', 'variants', 'headers', 'body', 'package', 'settings'].some((key) => key in info)) {
        throw new Error('模型含单独的参数或变体配置，请通过表单配置，避免导入时丢失这些设置');
      }
      return [{ ...common, id: crypto.randomUUID(), name: models.length > 1 ? `${name} · ${id}` : name,
        model: string(info.id ?? info.modelID, '模型 ID', id) }];
    });
  } else if ('env' in config) {
    const env = object(config.env, 'env');
    const allowed = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'];
    if (Object.keys(env).some((key) => !allowed.includes(key))) throw new Error('Claude 配置含其他环境设置，请仅保留地址、Key 和模型，其他参数通过表单配置');
    let baseUrl = string(env.ANTHROPIC_BASE_URL, 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com').replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1')) baseUrl += '/v1';
    providers = [{ ...createProvider('anthropic'), name, baseUrl, model: string(env.ANTHROPIC_MODEL, 'ANTHROPIC_MODEL'),
      apiKey: string(env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY, 'API Key'),
      authMode: env.ANTHROPIC_AUTH_TOKEN ? 'bearer' : 'api-key' }];
  } else if ('protocol' in config && 'baseUrl' in config) {
    providers = [{ ...createProvider(), name,
      protocol: string(config.protocol, '协议') as ModelProvider['protocol'],
      baseUrl: string(config.baseUrl, '接口地址'), model: string(config.model, '模型名'), apiKey: string(config.apiKey, 'API Key'),
      endpointMode: string(config.endpointMode, '地址模式', config.builtin === true ? 'base' : 'full') as ModelProvider['endpointMode'],
      authMode: string(config.authMode, '鉴权方式', 'auto') as ModelProvider['authMode'],
      customHeaders: jsonField(config.customHeaders, '请求头'), customBody: jsonField(config.customBody, '额外参数'),
    }];
  } else throw new Error('未识别配置；支持本应用供应商、CC Switch 单供应商对象和 OpenCode V1 provider 配置');
  for (const provider of providers) {
    if (provider.customHeaders && /\{env:|\{file:|\$\{/.test(provider.customHeaders)) throw new Error('请求头包含未解析引用，请先替换为实际值');
    validateProvider(provider, false);
  }
  return providers;
}

export function importProviderConfigs(text: string): ModelProvider[] {
  const root = parseConfigObject(text, '导入配置');
  if ('providers' in root) throw new Error('暂不导入 OpenCode V2 providers 配置，请通过表单添加供应商');
  const providers = 'provider' in root
    ? Object.entries(object(root.provider, 'provider')).flatMap(([name, config]) => importOne(config, name))
    : importOne(root, '导入的供应商');
  if (!providers.length) throw new Error('配置中没有可导入的启用模型');
  return providers;
}
