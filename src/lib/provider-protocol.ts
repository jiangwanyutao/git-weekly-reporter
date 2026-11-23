import type { ModelProvider, ProviderProtocol } from '@/types';
import { resolveProviderAddress } from './provider-config.ts';

export function buildEndpoint(provider: ModelProvider, stream = false): string {
  const { baseUrl: address, endpointMode: mode } = resolveProviderAddress(provider);
  if (mode === 'full' && provider.protocol !== 'gemini') return address;
  const url = new URL(address);
  if (mode === 'base') {
    const path = provider.protocol === 'responses' ? '/responses'
      : provider.protocol === 'anthropic' ? '/messages'
        : provider.protocol === 'gemini'
          ? `/models/${encodeURIComponent(provider.model.replace(/^models\//, ''))}:generateContent`
          : '/chat/completions';
    const existing = url.pathname.replace(/\/+$/, '');
    url.pathname = existing.endsWith(path) ? existing : existing + path;
  }
  if (provider.protocol === 'gemini') {
    url.pathname = url.pathname.replace(/:(streamGenerateContent|generateContent)$/, stream ? ':streamGenerateContent' : ':generateContent');
    if (stream) url.searchParams.set('alt', 'sse');
    else if (url.searchParams.get('alt') === 'sse') url.searchParams.delete('alt');
  }
  return url.toString();
}

export function buildRequestBody(
  protocol: ProviderProtocol, model: string, prompt: string, stream: boolean,
  maxTokens = stream ? 32768 : 64,
): Record<string, unknown> {
  const temperature = stream ? 0.3 : 1.0;
  if (protocol === 'gemini') return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (protocol === 'responses') return {
    model, input: [{ role: 'user', content: prompt }], stream,
    temperature, max_output_tokens: maxTokens,
  };
  const body: Record<string, unknown> = {
    model, messages: [{ role: 'user', content: prompt }], stream,
    temperature, max_tokens: maxTokens,
  };
  if (protocol === 'glm') body.thinking = { type: 'enabled' };
  if (protocol === 'minimax') body.reasoning_split = true;
  return body;
}

function throwApiError(data: any) {
  const error = data?.error ?? data?.response?.error;
  if (error || data?.type === 'error' || data?.type === 'response.failed') {
    throw new Error(typeof error === 'string' ? error : error?.message || data?.message || '模型服务返回错误');
  }
}

function checkFinish(reason: string | undefined, text: string) {
  if (['length', 'max_tokens', 'MAX_TOKENS', 'max_output_tokens'].includes(reason ?? '')) {
    throw Object.assign(new Error('模型输出达到长度上限被截断，请减少提交数量或提高输出上限'), { partialContent: text });
  }
  if (reason && !['stop', 'end_turn', 'stop_sequence', 'STOP', 'completed'].includes(reason)) {
    throw new Error(`模型未正常完成响应 (${reason})`);
  }
}

export function readResponseText(protocol: ProviderProtocol, data: any): string {
  throwApiError(data);
  let text: string | undefined;
  let finish: string | undefined;
  if (protocol === 'anthropic') {
    text = data?.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('');
    finish = data?.stop_reason;
  } else if (protocol === 'responses') {
    text = data?.output_text ?? data?.output?.filter((item: any) => item.type === 'message')
      .flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === 'output_text')
      .map((part: any) => part.text).join('');
    finish = data?.status === 'incomplete' ? data?.incomplete_details?.reason ?? 'incomplete' : data?.status;
  } else if (protocol === 'gemini') {
    if (data?.promptFeedback?.blockReason) throw new Error(`模型拒绝了请求 (${data.promptFeedback.blockReason})`);
    text = data?.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought)
      .map((part: any) => part.text ?? '').join('');
    finish = data?.candidates?.[0]?.finishReason;
  } else {
    text = data?.choices?.[0]?.message?.content;
    finish = data?.choices?.[0]?.finish_reason;
  }
  checkFinish(finish, typeof text === 'string' ? text : '');
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回正文，请检查接口协议和模型配置');
  return text;
}

export interface ModelDelta {
  content: string;
  reasoning: string;
  finishReason?: string;
  done?: boolean;
}

export function parseStreamEvent(protocol: ProviderProtocol, raw: string, reasoning: string): ModelDelta {
  if (raw.trim() === '[DONE]') return { content: '', reasoning, done: true };
  let data: any;
  try { data = JSON.parse(raw); }
  catch { throw new Error('模型流响应不是有效 JSON，请检查接口协议'); }
  throwApiError(data);
  const result: ModelDelta = { content: '', reasoning };
  if (protocol === 'anthropic') {
    if (data.type === 'content_block_start') {
      result.content = data.content_block?.type === 'text' ? data.content_block.text ?? '' : '';
      result.reasoning += data.content_block?.type === 'thinking' ? data.content_block.thinking ?? '' : '';
    }
    if (data.type === 'content_block_delta') {
      result.content = data.delta?.type === 'text_delta' ? data.delta.text ?? '' : '';
      result.reasoning += data.delta?.type === 'thinking_delta' ? data.delta.thinking ?? '' : '';
    }
    if (data.type === 'message_delta') result.finishReason = data.delta?.stop_reason;
    if (data.type === 'message_stop') result.done = true;
  } else if (protocol === 'responses') {
    if (data.type === 'response.output_text.delta') result.content = data.delta ?? '';
    if (['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'].includes(data.type)) result.reasoning += data.delta ?? '';
    if (data.type === 'response.completed') { result.done = true; result.finishReason = 'completed'; }
    if (data.type === 'response.incomplete') {
      result.done = true;
      result.finishReason = data.response?.incomplete_details?.reason ?? 'incomplete';
    }
  } else if (protocol === 'gemini') {
    if (data?.promptFeedback?.blockReason) throw new Error(`模型拒绝了请求 (${data.promptFeedback.blockReason})`);
    for (const part of data.candidates?.[0]?.content?.parts ?? []) {
      if (part.thought) result.reasoning += part.text ?? '';
      else result.content += part.text ?? '';
    }
    result.finishReason = data.candidates?.[0]?.finishReason;
  } else {
    const choice = data.choices?.[0];
    const delta = choice?.delta;
    result.content = delta?.content ?? '';
    result.finishReason = choice?.finish_reason;
    if (delta?.reasoning_content) result.reasoning += delta.reasoning_content;
    else for (const part of delta?.reasoning_details ?? []) {
      if (typeof part.text === 'string') result.reasoning = part.text.startsWith(result.reasoning) ? part.text : result.reasoning + part.text;
    }
  }
  return result;
}

export { checkFinish };

// SSE 按空行分隔事件；保留跨字节分片、CRLF、多行 data 和没有末尾换行的最后事件。
export async function* readSseEvents(read: () => Promise<ReadableStreamReadResult<Uint8Array>>) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  while (true) {
    const { done, value } = await read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    while (buffer) {
      const separator = /\r\n|[\r\n]/.exec(buffer);
      if (!separator && !done) break;
      if (!done && separator?.[0] === '\r' && separator.index === buffer.length - 1) break;
      const line = separator ? buffer.slice(0, separator.index) : buffer;
      buffer = separator ? buffer.slice(separator.index + separator[0].length) : '';
      if (line === '') {
        if (data.length) yield data.join('\n');
        data = [];
      } else if (line === 'data' || line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (done) {
      if (data.length) yield data.join('\n');
      return;
    }
  }
}
