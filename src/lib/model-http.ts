type ModelHttpEvent =
  | { type: 'headers'; status: number; headers: Record<string, string> }
  | { type: 'chunk'; data: number[] }
  | { type: 'end' }
  | { type: 'error'; message: string };

// WebView 的跨域限制不适用于 Rust HTTP；保留 Response 接口供现有 SSE 解析使用。
export async function requestModel(
  url: string,
  apiKey: string,
  body: object,
  signal?: AbortSignal,
): Promise<Response> {
  signal?.throwIfAborted();
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  }

  const { invoke, Channel } = await import('@tauri-apps/api/core');
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  return new Promise<Response>((resolve, reject) => {
    let finished = false;
    let started: Promise<void>;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const cleanup = () => {
      finished = true;
      signal?.removeEventListener('abort', abort);
    };
    // 等待启动命令确认后取消，避免取消先于 Rust 注册请求。
    const cancelNative = () => started.then(() =>
      invoke<void>('cancel_model_request', { requestId }),
    ).catch(() => {});
    const fail = (error: unknown) => {
      if (finished) return;
      cleanup();
      const reason = error instanceof Error ? error : new Error(String(error));
      controller.error(reason);
      reject(reason);
    };
    const abort = () => {
      fail(signal?.reason ?? new DOMException('请求已取消', 'AbortError'));
      void cancelNative();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() {
        if (finished) return;
        cleanup();
        return cancelNative();
      },
    });
    const onEvent = new Channel<ModelHttpEvent>((event) => {
      if (finished) return;
      switch (event.type) {
        case 'headers':
          resolve(new Response([204, 205, 304].includes(event.status) ? null : stream, {
            status: event.status, headers: event.headers,
          }));
          break;
        case 'chunk':
          controller.enqueue(new Uint8Array(event.data));
          break;
        case 'end':
          cleanup();
          controller.close();
          break;
        case 'error':
          fail(new Error(event.message));
          break;
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    started = invoke<void>('start_model_request', { requestId, url, apiKey, body, onEvent });
    void started.catch(fail);
  });
}
