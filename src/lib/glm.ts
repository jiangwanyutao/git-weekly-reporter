import { requestModel } from './model-http.ts';
import { activeProxy } from './proxy.ts';
import type { AppSettings, ModelProvider } from '@/types';
import { validateProvider, buildProviderHeaders, applyCustomBody } from './provider-config.ts';
import { buildEndpoint, buildRequestBody, readResponseText, parseStreamEvent, readSseEvents, checkFinish } from './provider-protocol.ts';

// 从设置中取出当前生效的提供商（找不到则回退到第一个）
export function getActiveProvider(settings: AppSettings): ModelProvider | undefined {
  const list = settings.providers || [];
  return list.find((p) => p.id === settings.activeProviderId) ?? list[0];
}

// 流式生成的护栏：模型在长输入下会退化成无限重复，这些上限用来兜底
const STREAM_IDLE_MS = 90_000;        // 超过这么久没有新数据判定为卡死
const MAX_CONTENT_CHARS = 30_000;     // 正文硬上限
// 思考过程硬上限（历史死循环正是卡在这一段）。提交全部送进模型后，几百条改动逐条梳理
// 正常就要四五万字，打转靠下面的重复检测拦截，这里只兜底不重复的失控
const MAX_REASONING_CHARS = 80_000;
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

async function buildProviderError(
  response: Response,
  providerName: string,
  endpoint: string,
): Promise<Error> {
  if (response.status === 405) {
    await response.body?.cancel().catch(() => {});
    const url = new URL(endpoint);
    return new Error(`${providerName} 请求失败 (HTTP 405)：当前地址不接受 POST。请检查接口协议与地址模式，订阅网页不能用作 API 地址。实际请求：POST ${url.origin}${url.pathname}`);
  }
  let serverMessage = '';

  const errorText = await response.text().catch(() => '');
  try {
    const errorData = JSON.parse(errorText);
    serverMessage = errorData?.error?.message || errorData?.message || errorData?.msg || '';
  } catch {
    serverMessage = errorText.trim();
  }
  if (typeof serverMessage !== 'string') serverMessage = '';

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

  if (apiKey === "MOCK") {
    return { providerName: name, model };
  }

  validateProvider(provider);
  const response = await requestModel(
    buildEndpoint(provider), apiKey,
    applyCustomBody(provider, buildRequestBody(protocol, model, "Reply with exactly OK", false)),
    undefined, buildProviderHeaders(provider, crypto.randomUUID()), 'POST', activeProxy(settings),
  );

  if (!response.ok) {
    throw await buildProviderError(response, name, buildEndpoint(provider));
  }

  readResponseText(protocol, await response.json());
  return { providerName: name, model };
}

export async function generateWeeklyReport(
  settings: AppSettings,
  promptTemplate: string,
  commits: string,
  projectContext: string,
  onStream?: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
  signal?: AbortSignal,
  sessionId = crypto.randomUUID(),
): Promise<string> {
  const provider = getActiveProvider(settings);
  if (!provider) {
    throw new Error("未配置任何模型提供商，请先在设置页添加");
  }
  const { apiKey, model, protocol } = provider;

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

  validateProvider(provider);
  const userPrompt = `${promptTemplate.replace("{{commits}}", () => commits)}

# 项目背景信息（仅供你理解项目用途，不要把这些背景本身写进周报）
以下是各相关项目的自动分析结果（来自 README、package.json 等）。每段以「## 项目 [项目名]」开头，其中的项目名与上方提交记录中每条前的 [项目名] 前缀一一对应，请据此把提交准确归类到对应项目，并在周报中沿用该项目名：
${projectContext}
`;

  try {
    const response = await requestModel(
      buildEndpoint(provider, true), apiKey,
      applyCustomBody(provider, buildRequestBody(protocol, model, userPrompt, true)), signal,
      buildProviderHeaders(provider, sessionId), 'POST', activeProxy(settings),
    );

    if (!response.ok) {
      throw await buildProviderError(response, provider.name, buildEndpoint(provider, true));
    }

    if (!response.body) throw new Error("Response body is empty");

    const reader = response.body.getReader();
    let fullContent = "";
    let fullReasoning = "";
    let contentCheckedAt = 0;
    let reasoningCheckedAt = 0;
    let loopGuard: string | null = null;
    let finishReason: string | null = null;
    let completed = false;

    try {
      for await (const data of readSseEvents(() => readWithTimeout(reader, STREAM_IDLE_MS))) {
        if (!data.trim()) continue;
        const delta = parseStreamEvent(protocol, data, fullReasoning);
        if (delta.finishReason) finishReason = delta.finishReason;
        if (delta.finishReason || delta.done) completed = true;
        if (delta.reasoning !== fullReasoning) {
          fullReasoning = delta.reasoning;
          onReasoning?.(fullReasoning);
        }
        if (delta.content) {
          fullContent += delta.content;
          onStream?.(fullContent);
        }
        if (delta.done) break;

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
          break;
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
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
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

    checkFinish(finishReason ?? undefined, fullContent);
    if (!completed) {
      throw Object.assign(new Error(`${provider.name} 响应中途结束，请重新生成`), { partialContent: fullContent });
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

// 二次润色：只把指定的技术词所在句子改写成人话，其余一个字不动。
// 仅在确定性扫描真的发现残留时才调用，干净的周报不会走到这里。
// 调用方负责校验结构指纹，发现模型改坏了就退回原稿。
export async function polishReport(
  settings: AppSettings,
  markdown: string,
  jargon: string[],
  signal?: AbortSignal,
  sessionId = crypto.randomUUID(),
): Promise<string> {
  const provider = getActiveProvider(settings);
  if (!provider) throw new Error("未配置模型，无法润色");
  if (!jargon.length) return markdown;

  if (provider.apiKey === "MOCK") {
    return jargon.reduce((text, w) => text.split(w).join('相关配置'), markdown);
  }

  validateProvider(provider);
  const prompt = `下面是一份已经写好的周报，整体没问题，只是个别地方混进了读者看不懂的技术词。

请只做一件事：把下列技术词所在的句子改写成人话，**其他内容一个字都不要动**。

需要处理的技术词：
${jargon.map((w) => `- ${w}`).join('\n')}

改写要求：
- 所有栏目标题、项目分段、条目编号、表格、空行和加粗标题的格式必须完全保持原样
- 不许增加、删除或合并任何条目
- 用这项改动对**使用者**的意义来表述；实在判断不出含义的，就把该技术词连同它所在的短语一起去掉，保证句子读得通
- 直接输出改写后的完整周报，不要任何解释或前后缀

周报正文：
${markdown}`;

  const response = await requestModel(
    buildEndpoint(provider), provider.apiKey,
    // 输出是整篇周报，预算按原文长度放宽
    applyCustomBody(provider, buildRequestBody(provider.protocol, provider.model, prompt, false, 16384)), signal,
    buildProviderHeaders(provider, sessionId), 'POST', activeProxy(settings),
  );

  if (!response.ok) throw await buildProviderError(response, provider.name, buildEndpoint(provider));

  return readResponseText(provider.protocol, await response.json()).trim();
}
