import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { requestModel } from '../src/lib/model-http.ts';
import { testModelConnection, generateWeeklyReport, polishReport } from '../src/lib/glm.ts';
import { fetchProviderModels } from '../src/lib/provider-models.ts';

const endpoint = 'https://example.test/api/plan/v3/chat/completions';
const settings = { activeProviderId: 'ark', providers: [{
  id: 'ark', name: '方舟', protocol: 'openai', apiKey: 'test-key',
  model: 'test-model', baseUrl: endpoint,
}] };
const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

test('GET 模型发现请求透传原生 method 和鉴权且不发送正文', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  const headers = { 'x-api-key': 'discovery-key' };
  mockIPC((command, args) => {
    assert.equal(command, 'start_model_request');
    assert.equal(args.method, 'GET');
    assert.equal(args.body, null);
    assert.deepEqual(args.headers, headers);
    args.onEvent.onmessage({ type: 'headers', status: 200, headers: {} });
    args.onEvent.onmessage({ type: 'chunk', data: bytes('{"data":[]}') });
    args.onEvent.onmessage({ type: 'end' });
  });
  const response = await requestModel(endpoint, '', { ignored: true }, undefined, headers, 'GET');
  assert.deepEqual(await response.json(), { data: [] });
});

test('Web GET 无正文、保留错误响应，并拒绝不支持的 method', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test');
    return new Response('denied', { status: 401 });
  };
  const response = await requestModel(endpoint, 'test', { ignored: true }, undefined, undefined, 'GET');
  assert.equal(response.status, 401);
  assert.equal(await response.text(), 'denied');
  await assert.rejects(requestModel(endpoint, '', {}, undefined, undefined, 'DELETE'), /仅支持 GET 或 POST/);
});

test('自定义协议请求头完整传给 Rust，不被旧 Bearer 鉴权覆盖', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  const headers = { 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01', 'x-opencode-session': 'report-id' };
  mockIPC((command, args) => {
    assert.equal(command, 'start_model_request');
    assert.deepEqual(args.headers, headers);
    assert.equal(args.headers.authorization, undefined);
    args.onEvent.onmessage({ type: 'headers', status: 200, headers: {} });
    args.onEvent.onmessage({ type: 'end' });
  });
  const response = await requestModel(endpoint, 'test-key', {}, undefined, headers);
  assert.equal(await response.text(), '');
});

test('桌面模型请求使用原生 HTTP：测试、流式生成和润色', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('不应调用 WebView fetch'); };
  t.after(() => { clearMocks(); delete globalThis.window; globalThis.fetch = originalFetch; });
  let requests = 0;
  mockIPC((command, args) => {
    assert.equal(command, 'start_model_request');
    assert.equal(args.url, endpoint);
    assert.equal(args.apiKey, 'test-key');
    assert.equal(args.method, 'POST');
    assert.equal(args.proxyUrl, 'http://127.0.0.1:7897');
    assert.equal(args.body.model, 'test-model');
    requests++;
    const send = args.onEvent.onmessage;
    send({ type: 'headers', status: 200, headers: {} });
    const body = args.body.stream
      ? 'data: {"choices":[{"delta":{"content":"完成修复"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
      : JSON.stringify({ choices: [{ message: { content: '完成修复' } }] });
    // 刻意切开中文 UTF-8 字节，确保流式解码不丢字。
    const data = bytes(body);
    for (let i = 0; i < data.length; i += 2) send({ type: 'chunk', data: data.slice(i, i + 2) });
    send({ type: 'end' });
  });
  const proxied = { ...settings, proxyEnabled: true, proxyUrl: ' 127.0.0.1:7897 ' };
  assert.equal((await testModelConnection(proxied)).providerName, '方舟');
  assert.equal(await generateWeeklyReport(proxied, '{{commits}}', '修复', ''), '完成修复');
  assert.equal(await polishReport(proxied, '完成修复', ['修复']), '完成修复');
  assert.equal(requests, 3);
});

test('模型发现透传指定代理，关闭代理的连接测试不发送已保存代理', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  mockIPC((_command, args) => {
    const discovery = args.method === 'GET';
    assert.equal(args.proxyUrl, discovery ? 'http://127.0.0.1:7897' : undefined);
    args.onEvent.onmessage({ type: 'headers', status: 200, headers: {} });
    args.onEvent.onmessage({ type: 'chunk', data: bytes(JSON.stringify(discovery
      ? { data: [{ id: 'test-model' }] }
      : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })) });
    args.onEvent.onmessage({ type: 'end' });
  });
  assert.deepEqual(await fetchProviderModels(settings.providers[0], undefined, 'http://127.0.0.1:7897'), [{ id: 'test-model', name: 'test-model' }]);
  await testModelConnection({ ...settings, proxyEnabled: false, proxyUrl: 'http://127.0.0.1:7897' });
});

test('网页模式明确拒绝指定代理，不悄悄绕过代理发送请求', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = () => { throw new Error('不应发起请求'); };
  await assert.rejects(requestModel(endpoint, 'test', {}, undefined, undefined, 'POST', 'http://127.0.0.1:7897'), /网页模式无法指定请求代理/);
});

test('原生 HTTP 保留服务端鉴权错误', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  mockIPC((_command, args) => {
    args.onEvent.onmessage({ type: 'headers', status: 401, headers: {} });
    args.onEvent.onmessage({ type: 'chunk', data: bytes('{"error":{"message":"invalid api key"}}') });
    args.onEvent.onmessage({ type: 'end' });
  });
  await assert.rejects(testModelConnection(settings), /API Key 无效/);
});

test('原生启动失败和流中断均向调用方报错', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  mockIPC(() => { throw '无法建立连接'; });
  await assert.rejects(requestModel(endpoint, 'test', {}), /无法建立连接/);
  mockIPC((_command, args) => {
    args.onEvent.onmessage({ type: 'headers', status: 200, headers: {} });
    args.onEvent.onmessage({ type: 'error', message: '连接中断' });
  });
  await assert.rejects(testModelConnection(settings), /连接中断/);
});

test('取消已开始的响应会终止 Rust 请求', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  const commands: string[] = [];
  mockIPC((command, args) => {
    commands.push(command);
    if (command === 'start_model_request') args.onEvent.onmessage({ type: 'headers', status: 200, headers: {} });
  });
  const abort = new AbortController();
  const response = await requestModel(endpoint, 'test', {}, abort.signal, undefined, 'GET');
  abort.abort();
  await assert.rejects(response.text(), { name: 'AbortError' });
  assert.deepEqual(commands, ['start_model_request', 'cancel_model_request']);
  commands.length = 0;
  const other = await requestModel(endpoint, 'test', {}, undefined, undefined, 'GET');
  await other.body.cancel();
  assert.deepEqual(commands, ['start_model_request', 'cancel_model_request']);
});

test('启动确认前取消：等待注册完成后再取消，已取消的请求不会启动', async (t) => {
  globalThis.window = { crypto: globalThis.crypto };
  t.after(() => { clearMocks(); delete globalThis.window; });
  const abort = new AbortController();
  let acknowledge: () => void;
  let started: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const commands: string[] = [];
  mockIPC((command) => {
    commands.push(command);
    if (command === 'start_model_request') {
      started();
      return new Promise<void>((resolve) => { acknowledge = resolve; });
    }
  });
  const result = requestModel(endpoint, 'test', {}, abort.signal);
  await ready;
  abort.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(commands.length, 1);
  acknowledge();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands, ['start_model_request', 'cancel_model_request']);
  await assert.rejects(requestModel(endpoint, 'test', {}, abort.signal), { name: 'AbortError' });
  assert.equal(commands.length, 2);
});
