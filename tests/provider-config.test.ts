import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, validateProvider, buildProviderHeaders, applyCustomBody } from '../src/lib/provider-config.ts';
import { importProviderConfigs } from '../src/lib/provider-import.ts';

const provider = () => ({ ...createProvider('openai'), apiKey: 'test-key', model: 'test-model' });

test('旧配置不要求迁移，新配置使用 Base URL，模板不会替用户猜模型', () => {
  const old = { id: 'old', name: '旧供应商', protocol: 'openai', apiKey: 'test', model: 'test', baseUrl: 'https://example.test/chat/completions' };
  validateProvider(old);
  assert.equal(old.endpointMode, undefined);
  const go = createProvider('opencode-go');
  assert.equal(go.endpointMode, 'base');
  assert.equal(go.model, '');
  assert.match(go.customHeaders, /sessionId/);
  validateProvider(go, false);
  assert.throws(() => validateProvider(go), /模型名/);
});

test('按协议鉴权，可用自定义请求头或无需鉴权，并精确替换会话占位符', () => {
  const p = provider();
  assert.equal(buildProviderHeaders(p, 'session-1').authorization, 'Bearer test-key');
  assert.equal(buildProviderHeaders({ ...p, protocol: 'anthropic' }, 's')['x-api-key'], 'test-key');
  assert.equal(buildProviderHeaders({ ...p, protocol: 'gemini' }, 's')['x-goog-api-key'], 'test-key');
  assert.equal(buildProviderHeaders({ ...p, apiKey: '', authMode: 'none' }, 's').authorization, undefined);
  const headers = buildProviderHeaders({ ...p, apiKey: '$&', customHeaders: JSON.stringify({
    Authorization: 'Custom {{apiKey}}', 'x-opencode-session': '{{sessionId}}', 'X-Repeat': '{{apiKey}}/{{apiKey}}',
  }) }, 'report-1');
  assert.equal(headers.authorization, 'Custom $&');
  assert.equal(headers['x-repeat'], '$&/$&');
  assert.equal(headers['x-opencode-session'], 'report-1');
  assert.equal(headers['user-agent'], 'AI-Weekly-Reporter');
  assert.equal(buildProviderHeaders({ ...p, apiKey: '', customHeaders: '{"Authorization":"Bearer external"}' }, 's').authorization, 'Bearer external');
});

test('输入校验拒绝无效 URL、危险头、换行、重复头和未支持的占位符', () => {
  const p = provider();
  for (const baseUrl of ['file:///etc/passwd', 'https://user:secret@example.test', 'https://example.test/#x', 'not-url']) {
    assert.throws(() => validateProvider({ ...p, baseUrl }));
  }
  for (const customHeaders of ['[]', 'broken', '{"Authorization":1}', '{"Host":"evil"}', '{"Cookie":"secret"}',
    '{"X-Test":"hello\\r\\nAuthorization: bad"}', '{"X-Test":"a","x-test":"b"}', '{"X-Test":"{{unknown}}"}', '{"Content-Type":"text/plain"}']) {
    assert.throws(() => validateProvider({ ...p, customHeaders }));
  }
  assert.throws(() => buildProviderHeaders({ ...p, apiKey: '', authMode: 'none', customHeaders: '{"X-Token":"{{apiKey}}"}' }, 's'), /API Key/);
  assert.throws(() => validateProvider({ ...p, customBody: '{"__proto__":{"polluted":true}}' }));
  assert.equal({}.polluted, undefined);
});

test('额外参数合并嵌套对象，null 删除默认选项，不能替换应用输入和流模式', () => {
  const body = { model: 'test-model', stream: true, temperature: 0.3, generationConfig: { temperature: 0.3, maxOutputTokens: 8000 } };
  const result = applyCustomBody({ ...provider(), customBody: '{"temperature":null,"generationConfig":{"temperature":0.8},"reasoning":{"effort":"low"}}' }, body);
  assert.equal(result.temperature, undefined);
  assert.deepEqual(result.generationConfig, { temperature: 0.8, maxOutputTokens: 8000 });
  assert.equal(body.temperature, 0.3);
  for (const key of ['model', 'stream', 'messages', 'input', 'contents']) {
    assert.throws(() => applyCustomBody({ ...provider(), customBody: JSON.stringify({ [key]: null }) }, body), /不能覆盖/);
  }
});

test('导入 CC Switch / OpenCode V1，按 SDK 区分 Responses 和 Chat，不覆盖原始 ID', () => {
  const raw = { id: 'old-id', name: '第三方', settingsConfig: { npm: '@ai-sdk/openai', options: {
    baseURL: 'https://example.test/v1', apiKey: 'test-key', headers: { 'X-Workspace': 'team' },
  }, models: { 'model-a': {}, 'model-b': {}, disabled: { disabled: true } } } };
  const imported = importProviderConfigs(JSON.stringify(raw));
  assert.equal(imported.length, 2);
  assert.equal(imported[0].protocol, 'responses');
  assert.equal(imported[0].endpointMode, 'base');
  assert.equal(imported[1].model, 'model-b');
  assert.notEqual(imported[0].id, 'old-id');
  assert.notEqual(imported[0].id, imported[1].id);
  const chat = importProviderConfigs(JSON.stringify({ provider: { custom: { ...raw.settingsConfig, npm: '@ai-sdk/openai-compatible' } } }));
  assert.equal(chat[0].protocol, 'openai');
  assert.deepEqual(JSON.parse(chat[0].customHeaders), { 'X-Workspace': 'team' });
});

test('导入 Claude 环境配置和本应用供应商，保留鉴权和额外参数', () => {
  const [claude] = importProviderConfigs(JSON.stringify({ name: 'Claude 中转', settingsConfig: { env: {
    ANTHROPIC_BASE_URL: 'https://example.test', ANTHROPIC_AUTH_TOKEN: 'test', ANTHROPIC_MODEL: 'claude-test',
  } } }));
  assert.equal(claude.protocol, 'anthropic');
  assert.equal(claude.baseUrl, 'https://example.test/v1');
  assert.equal(claude.authMode, 'bearer');
  const [ours] = importProviderConfigs(JSON.stringify({ ...provider(), customBody: { temperature: null } }));
  assert.equal(ours.builtin, false);
  assert.deepEqual(JSON.parse(ours.customBody), { temperature: null });
  const [legacy] = importProviderConfigs(JSON.stringify({ ...provider(), builtin: true, endpointMode: undefined }));
  assert.equal(legacy.endpointMode, 'base');
  assert.equal(legacy.builtin, false);
});

test('不把未知 SDK、V2、未解析密钥引用或模型变体当成可用配置导入', () => {
  const raw = { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://example.test/v1' }, models: { test: {} } };
  for (const config of [
    { providers: { test: {} } }, { ...raw, npm: '@ai-sdk/amazon-bedrock' },
    { ...raw, options: { ...raw.options, apiKey: '{env:API_KEY}' } },
    { ...raw, options: { ...raw.options, resourceName: 'unsupported' } },
    { ...raw, models: { test: { variants: { high: {} } } } },
    { ...raw, models: { test: { disabled: true } } },
    { ...raw, models: { '{env:MODEL}': {} } },
    { ...provider(), customBody: { metadata: { token: '{file:secret}' } } },
    { ...provider(), customHeaders: { 'X-Token': '${TOKEN}' } },
    { settingsConfig: raw, meta: { apiFormat: 'openai_chat' } },
    { settingsConfig: raw, meta: { isFullUrl: true } },
    { settingsConfig: raw, meta: { localProxyRequestOverrides: { headers: {} } } },
  ]) assert.throws(() => importProviderConfigs(JSON.stringify(config)));
});
