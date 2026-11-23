import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEndpoint, buildRequestBody, readResponseText, parseStreamEvent, readSseEvents } from '../src/lib/provider-protocol.ts';
import { generateWeeklyReport, polishReport, testModelConnection } from '../src/lib/glm.ts';

const content = '完成中文周报';
const provider = (protocol = 'openai', patch = {}) => ({
  id: 'custom', name: '自定义', protocol, apiKey: 'fixture-key', model: 'test-model',
  baseUrl: 'https://models.example/v1', endpointMode: 'base', ...patch,
});
const settings = (p) => ({ providers: [p], activeProviderId: p.id });
const event = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const responseBody = (protocol, text = content) => {
  if (protocol === 'responses') return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
  if (protocol === 'anthropic') return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
  if (protocol === 'gemini') return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
  return { choices: [{ message: { content: text }, finish_reason: 'stop' }] };
};
const streamBody = (protocol) => {
  if (protocol === 'responses') return event({ type: 'response.reasoning_summary_text.delta', delta: '思考' })
    + event({ type: 'response.output_text.delta', delta: content }) + event({ type: 'response.completed' });
  if (protocol === 'anthropic') return event({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '思考' } })
    + event({ type: 'content_block_delta', delta: { type: 'text_delta', text: content } })
    + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + event({ type: 'message_stop' });
  if (protocol === 'gemini') return event({ candidates: [{ content: { parts: [{ text: '思考', thought: true }, { text: content }] }, finishReason: 'STOP' }] });
  return event({ choices: [{ delta: { content, reasoning_content: '思考' }, finish_reason: 'stop' }] }) + 'data: [DONE]';
};
function byteStream(text, onCancel = () => {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 2));
      offset = Math.min(offset + 2, bytes.length);
    },
    cancel: onCancel,
  });
}

test('端点模式保留旧配置并按协议拼接，Gemini 同时支持生成和测试', () => {
  for (const [protocol, suffix] of [['openai', '/chat/completions'], ['responses', '/responses'], ['anthropic', '/messages']]) {
    assert.equal(buildEndpoint(provider(protocol)), `https://models.example/v1${suffix}`);
    assert.equal(buildEndpoint(provider(protocol, { endpointMode: 'full', baseUrl: 'https://models.example/custom?q=1' })), 'https://models.example/custom?q=1');
  }
  assert.equal(buildEndpoint(provider('openai', { endpointMode: undefined, builtin: false })), 'https://models.example/v1');
  assert.equal(buildEndpoint(provider('glm', { endpointMode: undefined, builtin: true })), 'https://models.example/v1/chat/completions');
  const gemini = provider('gemini', { baseUrl: 'https://models.example/v1beta?project=one', model: 'models/gemini-test' });
  assert.equal(buildEndpoint(gemini), 'https://models.example/v1beta/models/gemini-test:generateContent?project=one');
  assert.equal(buildEndpoint(gemini, true), 'https://models.example/v1beta/models/gemini-test:streamGenerateContent?project=one&alt=sse');
  assert.equal(buildEndpoint({ ...gemini, endpointMode: 'full', baseUrl: buildEndpoint(gemini, true) }), buildEndpoint(gemini));
});

test('请求体只包含对应协议字段，原有 GLM/MiniMax 私有字段保留', () => {
  const responses = buildRequestBody('responses', 'test', 'prompt', true);
  assert.equal(responses.max_output_tokens, 32768);
  assert.deepEqual(responses.input, [{ role: 'user', content: 'prompt' }]);
  assert.equal(responses.messages, undefined);
  const gemini = buildRequestBody('gemini', 'test', 'prompt', false);
  assert.deepEqual(gemini.contents, [{ role: 'user', parts: [{ text: 'prompt' }] }]);
  assert.deepEqual(gemini.generationConfig, { temperature: 1, maxOutputTokens: 64 });
  assert.equal(gemini.stream, undefined);
  assert.deepEqual(buildRequestBody('glm', 'test', 'prompt', true).thinking, { type: 'enabled' });
  assert.equal(buildRequestBody('minimax', 'test', 'prompt', true).reasoning_split, true);
});

for (const protocol of ['openai', 'responses', 'anthropic', 'gemini']) {
  test(`${protocol}：连接测试、流式生成、润色共用协议和自定义配置`, async (t) => {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    const p = provider(protocol, { customHeaders: '{"x-session":"{{sessionId}}","x-vendor":"fixture"}', customBody: '{"temperature":null,"vendor_option":true}' });
    let calls = 0;
    const sessions: string[] = [];
    globalThis.fetch = async (url, init) => {
      calls++;
      const headers = new Headers(init.headers);
      const body = JSON.parse(init.body);
      sessions.push(headers.get('x-session'));
      assert.equal(headers.get('x-vendor'), 'fixture');
      assert.equal(headers.get(protocol === 'anthropic' ? 'x-api-key' : protocol === 'gemini' ? 'x-goog-api-key' : 'authorization'), protocol === 'anthropic' || protocol === 'gemini' ? 'fixture-key' : 'Bearer fixture-key');
      assert.equal(body.vendor_option, true);
      assert.equal(body.temperature, undefined);
      const streaming = protocol === 'gemini' ? String(url).includes(':streamGenerateContent') : body.stream;
      if (streaming) return new Response(byteStream(streamBody(protocol)), { headers: { 'Content-Type': 'text/event-stream' } });
      return Response.json(responseBody(protocol));
    };
    assert.equal((await testModelConnection(settings(p))).providerName, '自定义');
    let reasoning = '';
    assert.equal(await generateWeeklyReport(settings(p), '{{commits}}', '提交', '', undefined, (text) => { reasoning = text; }, undefined, 'report-session'), content);
    assert.equal(reasoning, '思考');
    assert.equal(await polishReport(settings(p), content, ['中文'], undefined, 'report-session'), content);
    assert.deepEqual(sessions.slice(1), ['report-session', 'report-session']);
    assert.equal(calls, 3);
  });
}

test('无鉴权本地提供商允许空 Key', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init.headers).has('authorization'), false);
    return Response.json(responseBody('openai'));
  };
  await testModelConnection(settings(provider('openai', { authMode: 'none', apiKey: '' })));
});

test('SSE 支持多行 data、跨 CRLF 分片和没有末尾空行的最后事件', async () => {
  const reader = byteStream(': heartbeat\r\nevent: message\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\ndata: [DONE]').getReader();
  const chunks: string[] = [];
  for await (const value of readSseEvents(() => reader.read())) chunks.push(value);
  assert.deepEqual(chunks, ['{"text":\n"中文"}', '[DONE]']);
});

test('四种协议保留截断和服务端错误，协议不匹配不判成功', () => {
  for (const protocol of ['openai', 'responses', 'anthropic', 'gemini']) {
    assert.throws(() => readResponseText(protocol, { error: { message: '余额不足' } }), /余额不足/);
    assert.throws(() => readResponseText(protocol, { status: 'ok' }), /没有返回正文|未正常完成/);
    assert.throws(() => parseStreamEvent(protocol, '{"error":{"message":"服务不可用"}}', ''), /服务不可用/);
  }
  const fixtures = [
    ['openai', { choices: [{ message: { content }, finish_reason: 'length' }] }],
    ['anthropic', { content: [{ type: 'text', text: content }], stop_reason: 'max_tokens' }],
    ['responses', { ...responseBody('responses'), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }],
    ['gemini', { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'MAX_TOKENS' }] }],
  ];
  for (const [protocol, body] of fixtures) assert.throws(() => readResponseText(protocol, body), (error) => /截断/.test(error.message) && error.partialContent === content);
});

test('流式服务端错误不会被 JSON 异常处理吞掉，并取消读取', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let cancelled = false;
  globalThis.fetch = async () => new Response(byteStream(event({ error: { message: '上游已断开' } }) + ': remains open', () => { cancelled = true; }));
  await assert.rejects(generateWeeklyReport(settings(provider()), '{{commits}}', '', ''), /上游已断开/);
  assert.equal(cancelled, true);
});

test('没有结束标志的流不会把部分正文当作成功结果', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(byteStream(event({ choices: [{ delta: { content } }] })));
  await assert.rejects(generateWeeklyReport(settings(provider()), '{{commits}}', '', ''), (error) => /中途结束/.test(error.message) && error.partialContent === content);
});
