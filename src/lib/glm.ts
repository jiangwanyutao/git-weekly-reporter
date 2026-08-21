import type { AppSettings, ModelProvider, ProviderProtocol } from '@/types';

export const abortController = new AbortController();

// 从设置中取出当前生效的提供商（找不到则回退到第一个）
export function getActiveProvider(settings: AppSettings): ModelProvider | undefined {
  const list = settings.providers || [];
  return list.find((p) => p.id === settings.activeProviderId) ?? list[0];
}

// 内置(glm/minimax)按 base 自动拼接 /chat/completions；自定义厂商使用用户填写的完整地址
function buildEndpoint(provider: ModelProvider): string {
  const url = (provider.baseUrl || '').trim();
  if (provider.builtin) {
    return `${url.replace(/\/+$/, '')}/chat/completions`;
  }
  return url;
}

function appendReasoningDelta(delta: any, current: string) {
  if (delta?.reasoning_content) {
    return current + delta.reasoning_content;
  }

  if (Array.isArray(delta?.reasoning_details)) {
    let next = current;
    for (const detail of delta.reasoning_details) {
      if (typeof detail?.text === 'string') {
        next = detail.text.startsWith(next) ? detail.text : next + detail.text;
      }
    }
    return next;
  }

  return current;
}

// 流式生成的护栏：模型在长输入下会退化成无限重复，这些上限用来兜底
const STREAM_IDLE_MS = 90_000;        // 超过这么久没有新数据判定为卡死
const MAX_CONTENT_CHARS = 30_000;     // 正文硬上限
const MAX_REASONING_CHARS = 40_000;   // 思考过程硬上限（历史死循环正是卡在这一段）
const DEGENERATE_CHECK_EVERY = 2_000; // 每新增这么多字符做一次重复检测

// 末尾是否出现连续三次相同的片段——模型打转的典型特征
function looksDegenerate(text: string): boolean {
  const tail = text.slice(-900);
  if (tail.length < 900) return false;
  for (let unit = 20; unit <= 300; unit += 4) {
    const a = tail.slice(-unit);
    if (a === tail.slice(-unit * 2, -unit) && a === tail.slice(-unit * 3, -unit * 2)) {
      return true;
    }
  }
  return false;
}

async function readWithTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  ms: number
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('STREAM_IDLE')), ms);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildRequestBody(
  protocol: ProviderProtocol,
  model: string,
  userPrompt: string,
  stream: boolean
) {
  const base = {
    model,
    messages: [{ role: "user", content: userPrompt }],
    stream,
    // 归纳类任务不需要高随机度；1.0 在长输出下显著抬高重复退化概率
    temperature: stream ? 0.3 : 1.0,
    // 提交多的一周条目数会明显变多，且带思考的模型会先耗掉一大块预算；
    // 预算给足，真正防失控靠下面的流式护栏而不是靠这个上限
    max_tokens: stream ? 32768 : 64,
  };

  if (protocol === 'minimax') {
    return { ...base, reasoning_split: true };
  }

  if (protocol === 'glm') {
    return { ...base, thinking: { type: "enabled" } };
  }

  // openai 兼容：标准 body，不附加厂商私有字段
  return base;
}

async function buildProviderError(
  response: Response,
  providerName: string
): Promise<Error> {
  let serverMessage = '';

  try {
    const errorData = await response.json();
    serverMessage =
      errorData?.error?.message ||
      errorData?.message ||
      errorData?.msg ||
      '';
  } catch {
    try {
      serverMessage = (await response.text()).trim();
    } catch {
      serverMessage = '';
    }
  }

  const normalizedMessage = serverMessage.toLowerCase();
  const isQuotaIssue =
    normalizedMessage.includes('余额不足') ||
    normalizedMessage.includes('resource') ||
    normalizedMessage.includes('quota') ||
    normalizedMessage.includes('insufficient') ||
    normalizedMessage.includes('充值');

  if (response.status === 401 || normalizedMessage.includes('invalid api key')) {
    return new Error(`${providerName} API Key 无效或已过期，请在设置页更新后重新保存`);
  }

  if (response.status === 429 && isQuotaIssue) {
    return new Error(`${providerName} 余额不足或无可用资源，请检查账户配额后重试`);
  }

  if (response.status === 429) {
    return new Error(`${providerName} 请求频率过高，请稍后重试`);
  }

  if (response.status >= 500) {
    return new Error(`${providerName} 服务暂时不可用，请稍后重试`);
  }

  if (serverMessage) {
    return new Error(`${providerName} 请求失败 (${response.status}): ${serverMessage}`);
  }

  return new Error(`${providerName} 请求失败 (${response.status})`);
}

export async function testModelConnection(settings: AppSettings): Promise<{
  providerName: string;
  model: string;
}> {
  const provider = getActiveProvider(settings);
  if (!provider) {
    throw new Error("未配置任何模型提供商，请先在设置页添加");
  }

  const { name, apiKey, model, protocol } = provider;

  if (!apiKey) {
    throw new Error(`${name} API Key 未填写`);
  }

  if (apiKey === "MOCK") {
    return { providerName: name, model };
  }

  const response = await fetch(buildEndpoint(provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(
      buildRequestBody(protocol, model, "Reply with exactly OK", false)
    ),
  });

  if (!response.ok) {
    throw await buildProviderError(response, name);
  }

  return { providerName: name, model };
}

export async function generateWeeklyReport(
  settings: AppSettings,
  promptTemplate: string,
  commits: string,
  projectContext: string,
  onStream?: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const provider = getActiveProvider(settings);
  if (!provider) {
    throw new Error("未配置任何模型提供商，请先在设置页添加");
  }
  const { apiKey, model, protocol } = provider;
  const endpoint = buildEndpoint(provider);

  if (!apiKey) {
    throw new Error("API Key is missing");
  }

  // Mock Mode
  if (apiKey === "MOCK") {
    const mockReasoning = "正在分析 Git 提交记录...\n检测到 React 前端项目结构...\n正在归纳工作重点...\n";
    let currentReasoning = "";

    // Simulate reasoning first
    for (const char of mockReasoning.split("")) {
         if (signal?.aborted) return "";
         await new Promise(resolve => setTimeout(resolve, 30));
         currentReasoning += char;
         if (onReasoning) onReasoning(currentReasoning);
    }

    const mockContent = `
# 本周工作周报 (Mock)

## 1. 本周工作重点
- 完成了 Git Weekly Reporter 的核心功能开发。
- 集成了 AI 模型用于自动生成周报。

## 2. 详细工作内容
- **前端开发**:
  - 实现了 Dashboard 页面，支持 Git 提交记录的展示。
  - 实现了 Settings 页面，支持 API Key 和 Prompt 配置。
- **后端开发**:
  - 使用 Rust 实现了 Git Log 的获取。

## 3. 下周计划
- 优化 UI/UX 体验。
- 添加更多自定义配置项。
`.trim();
    // ... existing mock content logic ...

    let current = "";
    const chars = mockContent.split("");
    for (const char of chars) {
      if (signal?.aborted) {
        console.log('Mock Generation aborted');
        return current;
      }
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 20));
      current += char;
      if (onStream) onStream(current);
    }
    return mockContent;
  }

  const userPrompt = `${promptTemplate.replace("{{commits}}", commits)}

# 项目背景信息（仅供你理解项目用途，不要把这些背景本身写进周报）
以下是各相关项目的自动分析结果（来自 README、package.json 等）。每段以「## 项目 [项目名]」开头，其中的项目名与上方提交记录中每条前的 [项目名] 前缀一一对应，请据此把提交准确归类到对应项目，并在周报中沿用该项目名：
${projectContext}
`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        buildRequestBody(protocol, model, userPrompt, true)
      ),
      signal: signal
    });

    if (!response.ok) {
      throw await buildProviderError(response, provider.name);
    }

    if (!response.body) throw new Error("Response body is empty");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";          // 跨网络分片的残行缓冲，缺了它会丢内容
    let fullContent = "";
    let fullReasoning = "";
    let contentCheckedAt = 0;
    let reasoningCheckedAt = 0;
    let loopGuard: string | null = null;
    let finishReason: string | null = null;

    try {
      streaming: while (true) {
        const { done, value } = await readWithTimeout(reader, STREAM_IDLE_MS);
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // 最后一段可能是被切断的半行，留到下一片再拼
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const choice = parsed?.choices?.[0];
            // 记下结束原因：length 表示被输出上限截断，会整段丢内容（曾丢掉过一整个项目）
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const delta = choice?.delta;
            if (!delta) continue;

            const updatedReasoning = appendReasoningDelta(delta, fullReasoning);
            if (updatedReasoning !== fullReasoning) {
              fullReasoning = updatedReasoning;
              if (onReasoning) onReasoning(fullReasoning);
            }

            if (delta.content) {
              fullContent += delta.content;
              if (onStream) onStream(fullContent);
            }
          } catch {
            console.warn("Failed to parse stream chunk:", data);
          }
        }

        // 护栏：正文/思考超长或开始打转就主动收流，避免无限生成
        if (fullContent.length - contentCheckedAt >= DEGENERATE_CHECK_EVERY) {
          contentCheckedAt = fullContent.length;
          if (looksDegenerate(fullContent)) loopGuard = 'content-repeat';
        }
        if (fullReasoning.length - reasoningCheckedAt >= DEGENERATE_CHECK_EVERY) {
          reasoningCheckedAt = fullReasoning.length;
          if (looksDegenerate(fullReasoning)) loopGuard = 'reasoning-repeat';
        }
        if (fullContent.length > MAX_CONTENT_CHARS) loopGuard = 'content-limit';
        if (fullReasoning.length > MAX_REASONING_CHARS) loopGuard = 'reasoning-limit';

        if (loopGuard) {
          await reader.cancel().catch(() => {});
          break streaming;
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation aborted');
        return fullContent; // Return what we have so far
      }
      if (error.message === 'STREAM_IDLE') {
        await reader.cancel().catch(() => {});
        if (fullContent.trim()) return fullContent;
        throw new Error(
          `${provider.name} 超过 ${STREAM_IDLE_MS / 1000} 秒没有返回新内容，已中断。请减少本次勾选的提交数量后重试`
        );
      }
      throw error;
    }

    if (loopGuard) {
      console.warn('Stream stopped by loop guard:', loopGuard);
      // 正文已经出来一部分就照常返回，用户至少拿到可用结果
      if (fullContent.trim()) return fullContent;
      throw new Error(
        `${provider.name} 陷入重复生成（思考过程已达 ${fullReasoning.length} 字仍未产出正文），已自动中断。` +
        `建议减少本次勾选的提交数量，或在设置页更换模型`
      );
    }

    if (!fullContent.trim()) {
      throw new Error(`${provider.name} 没有返回任何正文内容，请稍后重试或更换模型`);
    }

    // 被输出上限截断时会静默少写内容，必须让调用方知道，不能当成正常结果
    if (finishReason === 'length') {
      console.warn('Output truncated by max_tokens, content length:', fullContent.length);
      throw Object.assign(
        new Error(
          `${provider.name} 输出达到长度上限被截断，周报可能缺少后面的项目。` +
          `请减少本次勾选的提交数量后重试`
        ),
        { partialContent: fullContent }
      );
    }

    return fullContent;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error("GLM API Error:", error);
    throw error;
  }
}
