import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelsEndpoint, fetchProviderModels } from '../src/lib/provider-models.ts';
import { buildEndpoint } from '../src/lib/provider-protocol.ts';
import { buildProviderHeaders } from '../src/lib/provider-config.ts';
import { testModelConnection } from '../src/lib/glm.ts';

const provider = (patch = {}) => ({ id: 'test', name: '测试', protocol: 'openai', apiKey: 'fixture-key', model: '', baseUrl: 'https://example.test/v1', endpointMode: 'base', ...patch });
function mockFetch(t, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => { globalThis.fetch = previous; });
}

test('复现 Go 页面被当成 API 的 405：测试和列表统一改用推理地址并自动附会话头', async (t) => {
  const p = provider({ baseUrl: 'https://opencode.ai/zen/go/', model: 'fixture-model' });
  assert.equal(buildEndpoint(p), 'https://opencode.ai/inference/go/v1/chat/completions');
  assert.equal(buildModelsEndpoint(p), 'https://opencode.ai/inference/go/v1/models');
  assert.equal(buildProviderHeaders(p, 'same-session')['x-opencode-session'], 'same-session');
  mockFetch(t, async (url, init) => {
    if (String(url).includes('/zen/go')) return new Response('', { status: 405 });
    assert.equal(init.method, 'POST');
    assert.ok(new Headers(init.headers).get('x-opencode-session'));
    return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
  });
  await testModelConnection({ providers: [p], activeProviderId: p.id });
});

test('从四协议完整端点推导 models，保留查询参数，不重复拼接已填端点', () => {
  for (const suffix of ['chat/completions', 'responses', 'messages']) {
    assert.equal(buildModelsEndpoint(provider({ baseUrl: `https://example.test/v1/${suffix}?tenant=1`, endpointMode: 'full' })), 'https://example.test/v1/models?tenant=1');
  }
  assert.equal(buildModelsEndpoint(provider({ protocol: 'gemini', baseUrl: 'https://example.test/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=fixture', endpointMode: 'full' })), 'https://example.test/v1beta/models?key=fixture');
  assert.equal(buildEndpoint(provider({ baseUrl: 'https://example.test/v1/chat/completions', model: 'test' })), 'https://example.test/v1/chat/completions');
  assert.equal(buildModelsEndpoint(provider({ baseUrl: 'https://opencode.ai/inference/go/openai/v1' })), 'https://opencode.ai/inference/go/v1/models');
  assert.throws(() => buildModelsEndpoint(provider({ endpointMode: 'full', baseUrl: 'https://example.test/custom-operation' })), /无法.*推导/);
});

test('空模型可拉取：真正 GET 无正文，自定义鉴权生效，模型去重且保留 ID', async (t) => {
  mockFetch(t, async (url, init) => {
    assert.equal(url, 'https://example.test/v1/models');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get('authorization'), 'Custom fixture-key');
    return Response.json({ data: [{ id: 'model-a' }, { id: 'model-a' }, { id: 'model-b', name: 'Model B' }, { id: '' }, null] });
  });
  assert.deepEqual(await fetchProviderModels(provider({ customHeaders: '{"Authorization":"Custom {{apiKey}}"}' })), [{ id: 'model-a', name: 'model-a' }, { id: 'model-b', name: 'Model B' }]);
});

test('Gemini 遍历分页且只展示支持生成的模型', async (t) => {
  let calls = 0;
  mockFetch(t, async (url, init) => {
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'fixture-key');
    if (calls++ === 0) return Response.json({ models: [{ name: 'models/gemini-a', displayName: 'A', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' });
    assert.equal(new URL(url).searchParams.get('pageToken'), 'next');
    return Response.json({ models: [{ name: 'models/gemini-b' }] });
  });
  assert.deepEqual((await fetchProviderModels(provider({ protocol: 'gemini', baseUrl: 'https://example.test/v1beta' }))).map(m => m.id), ['gemini-a', 'gemini-b']);
});

test('Anthropic 遍历 has_more 分页，重复游标不会无限请求', async (t) => {
  let calls = 0;
  mockFetch(t, async (url, init) => {
    assert.equal(new Headers(init.headers).get('anthropic-version'), '2023-06-01');
    if (calls++ > 0) assert.equal(new URL(url).searchParams.get('after_id'), 'claude-a');
    return Response.json({ data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: true, last_id: 'claude-a' });
  });
  await assert.rejects(fetchProviderModels(provider({ protocol: 'anthropic' })), /分页异常/);
  assert.equal(calls, 2);
});

test('列表错误保留 HTTP 状态和操作提示，但不回显 Key、查询参数或上游正文', async (t) => {
  mockFetch(t, async () => new Response('secret-upstream-text', { status: 405 }));
  await assert.rejects(fetchProviderModels(provider({ baseUrl: 'https://example.test/v1?key=secret-key' })), error => {
    assert.match(error.message, /HTTP 405/);
    assert.match(error.message, /手动填写/);
    assert.doesNotMatch(error.message, /secret-/);
    return true;
  });
});

test('空列表、错误 JSON 和协议错误可区分；调用方能取消拉取', async (t) => {
  mockFetch(t, async () => Response.json({ data: [] }));
  assert.deepEqual(await fetchProviderModels(provider()), []);
  globalThis.fetch = async () => new Response('<html>landing page</html>');
  await assert.rejects(fetchProviderModels(provider()), /有效 JSON/);
  globalThis.fetch = async () => Response.json({ choices: [] });
  await assert.rejects(fetchProviderModels(provider()), /不是模型列表/);
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => {
    controller.abort();
    init.signal.throwIfAborted();
  };
  await assert.rejects(fetchProviderModels(provider(), controller.signal), { name: 'AbortError' });
});

test('连接测试的 405 展示实际 POST 地址且隐去查询参数', async (t) => {
  mockFetch(t, async () => new Response('', { status: 405 }));
  const p = provider({ model: 'test', baseUrl: 'https://example.test/v1?key=secret-key', endpointMode: 'full' });
  await assert.rejects(testModelConnection({ providers: [p], activeProviderId: p.id }), error => {
    assert.match(error.message, /HTTP 405/);
    assert.match(error.message, /POST https:\/\/example.test\/v1/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
});
