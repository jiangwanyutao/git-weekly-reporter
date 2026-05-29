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
    temperature: 1.0,
    max_tokens: stream ? 65536 : 64,
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

# Project Context Information
The following is an automated analysis of the project files (README, package.json, etc.) to help you understand the context of the work:
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
    let fullContent = "";
    let fullReasoning = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices[0]?.delta;

              const updatedReasoning = appendReasoningDelta(delta, fullReasoning);
              if (updatedReasoning !== fullReasoning) {
                fullReasoning = updatedReasoning;
                if (onReasoning) onReasoning(fullReasoning);
              }

              // Handle standard content
              if (delta?.content) {
                fullContent += delta.content;
                if (onStream) onStream(fullContent);
              }
            } catch (e) {
              console.warn("Failed to parse stream chunk:", data);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation aborted');
        return fullContent; // Return what we have so far
      }
      throw error;
    }

    return fullContent || "No content generated";
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error("GLM API Error:", error);
    throw error;
  }
}
