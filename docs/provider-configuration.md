# 自定义模型供应商

在「设置 → 模型提供商」选择预设，点击「添加提供商」，填写模型 ID 和密钥。也可以添加自定义供应商，选择协议、地址模式和认证方式。每张卡片的「测试连接」使用当前草稿；点击「设为当前」并保存后，生成周报才会使用它。

填写地址和认证后，可直接点击「拉取模型」，无需先填写模型名。列表使用原生 GET 请求，支持 OpenAI/Responses/Anthropic 的 `models` 接口，以及 Gemini 的模型列表和分页；选中模型会填入模型名，仍可手动输入。供应商未提供列表接口时会明确提示，不能用列表是否存在代替生成能力测试。修改地址、协议或认证后，旧列表会失效。

OpenCode Go 的 `/zen/go` 是订阅页面，不是 API。本应用会识别这个官方页面地址并转换为 `/inference/go/v1`，自动带上 Go 会话头；列表使用 `/inference/go/v1/models`。界面展示实际 POST 地址（隐藏查询参数），405 错误也会提示检查地址模式。其他厂商的网页地址不会被自动猜测转换。

## 协议与地址

| 协议 | 基础地址模式自动追加的路径 |
| --- | --- |
| OpenAI Chat Completions / GLM / MiniMax | `/chat/completions` |
| OpenAI Responses | `/responses` |
| Anthropic Messages | `/messages` |
| Google Gemini | `/models/{模型名}:generateContent`，流式使用 `streamGenerateContent?alt=sse` |

基础地址应包含供应商要求的版本前缀，例如 `/v1`。完整地址模式直接使用填写的端点；Gemini 会按测试/生成切换方法后缀与 `alt=sse`。旧配置不需要重新填写：内置供应商继续使用基础地址，旧自定义供应商继续使用完整地址。

自动认证使用 Bearer Token；Anthropic 使用 `x-api-key`，Gemini 使用 `x-goog-api-key`。还可明确选择 Bearer、API Key 请求头或不认证。桌面端统一通过 Rust HTTP 发送测试、生成和润色请求。

## 高级配置

请求头填写 JSON 对象，名称不区分大小写，自定义值覆盖自动生成的同名头。例如：

```json
{
  "Authorization": "Bearer {{apiKey}}",
  "x-opencode-session": "{{sessionId}}"
}
```

`{{apiKey}}` 使用密钥输入框中的值。`{{sessionId}}` 在一次周报生成与后续润色中保持一致，新一次生成会创建新值。测试连接有独立会话。客户端有自己的 User-Agent，也可用自定义请求头覆盖。

额外请求体递归合并对象；`null` 删除默认参数。例如某些模型不接受 temperature：

```json
{
  "temperature": null,
  "reasoning": { "effort": "low" }
}
```

参数名称必须符合所选协议。应用管理的 `model`、`messages`、`input`、`contents`、`stream` 不允许覆盖。HTTP 客户端管理的 Host、Content-Length、Cookie 等头不允许覆盖。错误 JSON 会阻止保存和请求。

## 导入配置

「导入配置 JSON」会追加供应商并选中首项，不覆盖现有配置；导入后需要保存。支持：

- 本应用单个供应商对象，包含 `protocol`、`baseUrl`、`model`、`apiKey`；建议明确填写 `endpointMode`。
- CC Switch 的单供应商包装对象 `{ "name": "...", "settingsConfig": { ... } }`，其中 settingsConfig 使用以下受支持格式。
- OpenCode V1 的 `provider` 映射或单个 `npm/options/models` 配置。支持 `@ai-sdk/openai-compatible`（Chat）、`@ai-sdk/openai`（Responses）、`@ai-sdk/anthropic`、`@ai-sdk/google`。每个启用模型导入为独立配置。
- Claude 的 `env` 子集：`ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`。

OpenCode V1 示例：

```json
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.example.com/v1",
        "apiKey": "replace-with-your-key"
      },
      "models": { "your-model-id": {} }
    }
  }
}
```

OpenCode V2、Codex TOML、OAuth 登录、Bedrock 签名和任意 npm SDK 不在本次导入范围。模型变体、额外 SDK 选项（包括 `setCacheKey`）或 CC Switch 中改变请求的代理/认证元数据会明确报错，需转为表单配置；环境变量/文件引用需先替换为实际值。导入文本可能包含密钥，不要提交进 Git。

OpenCode Go 提供地址与会话头预设，模型 ID 由用户填写。支持协议与请求头不代表获得订阅使用权限，账户额度、模型开放范围及使用限制仍由供应商决定。

## 网络与连接诊断

桌面端的连接测试、拉取模型、生成和润色共用设置页的代理开关及地址。开启时使用指定 HTTP/HTTPS 代理；关闭时使用 HTTP 客户端默认网络行为，不保证读取 Windows 系统代理。网页模式无法指定该代理，会明确提示使用桌面客户端。

每个供应商卡片保留本次连接测试结果及可复制的错误信息；修改连接配置或代理后旧结果失效。模型列表接口不可用不代表生成接口不可用，可手动填写模型 ID 后单独测试连接。

## 参考来源

供应商预设和配置导入设计参考 `farion1231/cc-switch`，参考版本 `4ad2c4b17f27f043ce0b1d7f6dc23e0247a80b15`。该项目采用 MIT License，Copyright (c) 2025 Jason Young。本实现复用本项目的设置组件与原生 HTTP 通道，未搬入 CC Switch 的代理、CLI 配置写入或 OAuth 子系统，也未新增依赖。
