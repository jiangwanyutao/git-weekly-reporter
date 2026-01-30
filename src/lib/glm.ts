export const abortController = new AbortController();

export async function generateWeeklyReport(
  apiKey: string,
  promptTemplate: string,
  commits: string,
  projectContext: string,
  onStream?: (chunk: string) => void,
  onReasoning?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
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
- 集成了 GLM-4.7 模型用于自动生成周报。

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
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-4.7-flash",
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
        thinking: {
          type: "enabled"
        },
        stream: true,
        temperature: 1.0,
        max_tokens: 65536,
      }),
      signal: signal
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Failed to generate report");
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

              // Handle reasoning content
              if (delta?.reasoning_content) {
                fullReasoning += delta.reasoning_content;
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
