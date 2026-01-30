# Tauri 自动更新配置指南

本指南将帮助你为 `git-weekly-reporter` 配置自动更新功能。

## 1. 生成签名密钥 (必须)

Tauri 的更新机制要求对更新包进行数字签名，以确保安全性。

请在终端中运行以下命令：

```bash
pnpm tauri signer generate -w src-tauri/tauri.conf.json
```

**执行后会发生什么：**

1.  终端会显示生成的 **公钥 (Public Key)** 和 **私钥 (Private Key)**。
2.  因为加了 `-w` 参数，**公钥** 会自动填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 字段。
3.  **重要：** 你必须妥善保存 **私钥**。

### 如何保存私钥

你需要将私钥设置为环境变量，这样在打包时 Tauri 才能使用它进行签名。

**Windows PowerShell (临时设置，仅当前终端有效):**
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="你的私钥内容..."
$env:TAURI_SIGNING_KEY_PASSWORD="你的密钥密码(如果设置了的话)"
```

**或者在打包脚本中设置 (推荐用于 CI/CD):**
在 GitHub Actions 等 CI 工具中，将其添加为 Secret。

---

## 2. 配置更新服务器

在 `src-tauri/tauri.conf.json` 中，你需要修改 `endpoints` 字段：

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://你的域名.com/updates/{{target}}/{{current_version}}"
    ],
    "pubkey": "自动生成的公钥"
  }
}
```

Tauri 会向这个 URL 发送 GET 请求。你需要在这个地址提供一个 JSON 响应。

### 更新接口的 JSON 格式

当 App 请求更新时，你的服务器应该返回如下格式的 JSON：

```json
{
  "version": "1.0.1",
  "notes": "修复了一些 Bug，优化了性能。",
  "pub_date": "2024-03-20T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "更新包的签名内容(由打包命令生成)",
      "url": "https://你的域名.com/releases/1.0.1/app-setup.nsis.zip"
    }
  }
}
```

*如果当前没有新版本，服务器应返回 204 No Content 状态码，或者返回空的 JSON。*

---

## 3. 如何发布新版本

当你开发完成并准备发布 `1.0.1` 版本时：

1.  **修改版本号**：
    - 更新 `package.json` 中的 `version` 为 `1.0.1`。
    - 更新 `src-tauri/tauri.conf.json` 中的 `version` 为 `1.0.1`。

2.  **设置私钥环境变量** (如果尚未设置)。

3.  **构建应用**：
    ```bash
    pnpm tauri build
    ```

4.  **获取发布文件**：
    打包完成后，在 `src-tauri/target/release/bundle/nsis/` (Windows) 下会生成安装包。
    同时，Tauri 会在控制台输出（或在输出目录生成）该更新包的 **签名字符串** 和 **.zip 更新包**。

5.  **部署**：
    - 将生成的 `.zip` 更新包和安装程序上传到你的服务器（或 GitHub Releases）。
    - 更新你的 JSON 接口内容，填入新的 `version`、`url` 和 `signature`。

## 4. 常见方案：使用 GitHub Releases (最简单)

如果你不想自己搭建服务器，可以使用 GitHub Releases。

1.  将 `endpoints` 配置为：
    `https://github.com/你的用户名/仓库名/releases/latest/download/latest.json`
2.  使用 GitHub Action 自动构建并发布 Release。
3.  每次 Release 时，上传 `latest.json` 和构建好的安装包。
