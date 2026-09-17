// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
struct NotionSyncResult {
    id: String,
    url: Option<String>,
}

// Notion API 单次请求最多允许 100 个 children 块。
const NOTION_MAX_CHILDREN_PER_REQUEST: usize = 100;

// 向 Notion 发送一次请求（POST 创建页面 / PATCH 追加块），解析并校验响应。
async fn send_notion_request(
    client: &reqwest::Client,
    use_patch: bool,
    endpoint: &str,
    token: &str,
    payload: &Value,
) -> Result<Value, String> {
    let request_builder = if use_patch {
        // Notion 追加块接口必须使用 PATCH
        client.patch(endpoint)
    } else {
        client.post(endpoint)
    };

    let response = request_builder
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("Notion-Version", "2022-06-28")
        .json(payload)
        .send()
        .await
        .map_err(|error| {
            format!(
                "Notion 请求失败: {}。端点: {}。请检查网络或代理设置（Notion 在部分网络环境可能不可直连）",
                error, endpoint,
            )
        })?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .unwrap_or_else(|_| json!({ "message": "无法解析 Notion 响应" }));

    if !status.is_success() {
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("未知错误");
        return Err(format!("Notion 同步失败: {}", message));
    }

    Ok(body)
}

#[tauri::command]
async fn create_notion_page(
    token: String,
    parent_page_id: String,
    title: String,
    sync_mode: String,
    children: Value,
    proxy_url: Option<String>,
) -> Result<NotionSyncResult, String> {
    let children_blocks = match children {
        Value::Array(items) => items,
        _ => {
            return Err("Notion 同步失败: children 参数格式无效".to_string());
        }
    };

    let mode = sync_mode.trim().to_lowercase();
    let is_subpage_mode = mode == "subpage";

    let mut client_builder = reqwest::Client::builder();
    if let Some(proxy_raw) = proxy_url {
        let proxy = proxy_raw.trim().to_string();
        if !proxy.is_empty() {
            let parsed_proxy = reqwest::Proxy::all(&proxy)
                .map_err(|error| format!("Notion 代理地址无效: {}", error))?;
            client_builder = client_builder.proxy(parsed_proxy);
        }
    }

    let client = client_builder
        .build()
        .map_err(|error| format!("初始化 Notion HTTP 客户端失败: {}", error))?;

    // 按每 100 个块分批，避免超过 Notion 单次请求的 children 上限。
    let mut chunks = children_blocks.chunks(NOTION_MAX_CHILDREN_PER_REQUEST);

    if is_subpage_mode {
        // 首个请求创建子页面，携带第一批块（可能为空）。
        let first_chunk: Vec<Value> = chunks.next().map(|c| c.to_vec()).unwrap_or_default();
        let create_payload = json!({
            "parent": {
                "type": "page_id",
                "page_id": parent_page_id,
            },
            "properties": {
                "title": {
                    "title": [
                        {
                            "type": "text",
                            "text": { "content": title }
                        }
                    ]
                }
            },
            "children": first_chunk
        });

        let body = send_notion_request(
            &client,
            false,
            "https://api.notion.com/v1/pages",
            &token,
            &create_payload,
        )
        .await?;

        let new_page_id = body
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let url = body.get("url").and_then(Value::as_str).map(str::to_string);

        // 剩余批次追加到刚创建的子页面。
        if !new_page_id.is_empty() {
            let append_endpoint =
                format!("https://api.notion.com/v1/blocks/{}/children", new_page_id);
            for chunk in chunks {
                let append_payload = json!({ "children": chunk.to_vec() });
                send_notion_request(&client, true, &append_endpoint, &token, &append_payload)
                    .await?;
            }
        }

        return Ok(NotionSyncResult {
            id: new_page_id,
            url,
        });
    }

    // 追加模式：逐批 PATCH 到目标父页面。
    let append_endpoint = format!("https://api.notion.com/v1/blocks/{}/children", parent_page_id);
    for chunk in chunks {
        let append_payload = json!({ "children": chunk.to_vec() });
        send_notion_request(&client, true, &append_endpoint, &token, &append_payload).await?;
    }

    let normalized_id = parent_page_id.replace('-', "");
    Ok(NotionSyncResult {
        id: parent_page_id,
        url: Some(format!("https://www.notion.so/{}", normalized_id)),
    })
}

fn is_git_repo(dir: &Path) -> bool {
    // 普通仓库的 .git 是目录；子模块、worktree 的 .git 是文件，两种都算
    dir.join(".git").exists()
}

// 找出可导入的 Git 仓库：所选文件夹本身是仓库就只返回它；
// 否则只看下一层子文件夹，跳过隐藏目录和 node_modules。结果按路径排序。
fn find_git_repos(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    if is_git_repo(root) {
        return Ok(vec![root.to_path_buf()]);
    }
    let mut repos: Vec<PathBuf> = std::fs::read_dir(root)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            !name.starts_with('.') && name != "node_modules"
        })
        .map(|entry| entry.path())
        .filter(|path| is_git_repo(path))
        .collect();
    repos.sort();
    Ok(repos)
}

#[tauri::command]
fn scan_git_repos(path: String) -> Result<Vec<String>, String> {
    let repos = find_git_repos(Path::new(&path)).map_err(|error| format!("读取文件夹失败: {}", error))?;
    Ok(repos.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[cfg(test)]
mod scan_tests {
    use super::find_git_repos;
    use std::fs;
    use std::path::{Path, PathBuf};

    // 每个用例一个独立临时目录，结束后删除
    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gwr-scan-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_repo(dir: &Path) {
        fs::create_dir_all(dir.join(".git")).unwrap();
    }

    #[test]
    fn selected_folder_is_repo_returns_only_itself() {
        let root = temp_root("self");
        make_repo(&root);
        make_repo(&root.join("nested"));
        assert_eq!(find_git_repos(&root).unwrap(), vec![root.clone()]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_repos_one_level_down_sorted_skipping_hidden_and_node_modules() {
        let root = temp_root("children");
        make_repo(&root.join("b-app"));
        make_repo(&root.join("a-api"));
        fs::create_dir_all(root.join("docs")).unwrap();
        make_repo(&root.join(".cache"));
        make_repo(&root.join("node_modules"));
        make_repo(&root.join("docs").join("deep-repo"));
        // 子模块或 worktree 的 .git 是文件而不是目录，也算仓库
        fs::create_dir_all(root.join("c-worktree")).unwrap();
        fs::write(root.join("c-worktree").join(".git"), "gitdir: ../elsewhere").unwrap();

        assert_eq!(
            find_git_repos(&root).unwrap(),
            vec![root.join("a-api"), root.join("b-app"), root.join("c-worktree")]
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn folder_without_repos_returns_empty() {
        let root = temp_root("empty");
        fs::create_dir_all(root.join("notes")).unwrap();
        assert!(find_git_repos(&root).unwrap().is_empty());
        fs::remove_dir_all(&root).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, create_notion_page, scan_git_repos])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
