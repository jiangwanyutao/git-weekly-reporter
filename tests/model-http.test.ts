import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { requestModel } from '../src/lib/model-http.ts';
import { testModelConnection, generateWeeklyReport, polishReport } from '../src/lib/glm.ts';

const endpoint = 'https://example.test/api/plan/v3/chat/completions';
const settings = { activeProviderId: 'ark', providers: [{
  id: 'ark', name: '方舟', protocol: 'openai', apiKey: 'test-key',
  model: 'test-model', baseUrl: endpoint,
}] };
const bytes = (text: string) => Array.from(new TextEncoder().encode(text));

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
  assert.equal((await testModelConnection(settings)).providerName, '方舟');
  assert.equal(await generateWeeklyReport(settings, '{{commits}}', '修复', ''), '完成修复');
  assert.equal(await polishReport(settings, '完成修复', ['修复']), '完成修复');
  assert.equal(requests, 3);
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
  const response = await requestModel(endpoint, 'test', {}, abort.signal);
  abort.abort();
  await assert.rejects(response.text(), { name: 'AbortError' });
  assert.deepEqual(commands, ['start_model_request', 'cancel_model_request']);
  commands.length = 0;
  const other = await requestModel(endpoint, 'test', {});
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
