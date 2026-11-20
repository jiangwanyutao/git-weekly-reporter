// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

#[derive(Default)]
struct ModelRequests(Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>);

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ModelHttpEvent {
    Headers { status: u16, headers: HashMap<String, String> },
    Chunk { data: Vec<u8> },
    End,
    Error { message: String },
}

fn model_request(url: &str, api_key: &str, body: &Value) -> Result<reqwest::RequestBuilder, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "模型接口地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("模型接口地址必须使用 HTTP 或 HTTPS".to_string());
    }
    let client = reqwest::Client::builder()
        // 不跟随重定向，避免把模型密钥交给其他端点。
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("初始化模型 HTTP 客户端失败: {}", error.without_url()))?;
    Ok(client.post(url).bearer_auth(api_key).json(body))
}

async fn stream_model_request(
    request: reqwest::RequestBuilder,
    on_event: &tauri::ipc::Channel<ModelHttpEvent>,
) -> Result<(), String> {
    let mut response = request.send().await
        .map_err(|error| format!("模型请求失败: {}", error.without_url()))?;
    on_event.send(ModelHttpEvent::Headers {
        status: response.status().as_u16(),
        headers: response.headers().iter().filter_map(|(name, value)| {
            value.to_str().ok().map(|value| (name.to_string(), value.to_string()))
        }).collect(),
    }).map_err(|_| "模型响应通道已关闭".to_string())?;
    while let Some(chunk) = response.chunk().await
        .map_err(|error| format!("读取模型响应失败: {}", error.without_url()))? {
        on_event.send(ModelHttpEvent::Chunk { data: chunk.to_vec() })
            .map_err(|_| "模型响应通道已关闭".to_string())?;
    }
    on_event.send(ModelHttpEvent::End).map_err(|_| "模型响应通道已关闭".to_string())
}

#[tauri::command]
fn start_model_request(
    request_id: String,
    url: String,
    api_key: String,
    body: Value,
    on_event: tauri::ipc::Channel<ModelHttpEvent>,
    state: tauri::State<'_, ModelRequests>,
) -> Result<(), String> {
    let request = model_request(&url, &api_key, &body)?;
    let requests = state.0.clone();
    let mut active = state.0.lock().map_err(|_| "模型请求状态不可用".to_string())?;
    if active.contains_key(&request_id) {
        return Err("模型请求标识重复".to_string());
    }
    let task_id = request_id.clone();
    // 持锁到句柄登记完成，避免快速响应先清理、后登记造成泄漏。
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(message) = stream_model_request(request, &on_event).await {
            let _ = on_event.send(ModelHttpEvent::Error { message });
        }
        if let Ok(mut active) = requests.lock() {
            active.remove(&task_id);
        }
    });
    active.insert(request_id, handle);
    Ok(())
}

#[tauri::command]
fn cancel_model_request(request_id: String, state: tauri::State<'_, ModelRequests>) -> Result<(), String> {
    if let Some(handle) = state.0.lock().map_err(|_| "模型请求状态不可用".to_string())?.remove(&request_id) {
        handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod model_http_tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    #[test]
    fn rejects_non_http_model_endpoints() {
        for url in ["file:///secret", "ftp://example.com", "not a url"] {
            assert!(model_request(url, "test", &json!({})).is_err());
        }
    }

    #[test]
    fn aborting_request_closes_the_active_stream() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut reader = BufReader::new(&mut socket);
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" { break; }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
            }
            reader.read_exact(&mut vec![0; length]).unwrap();
            write!(socket, "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\nx\r\n").unwrap();
            assert_eq!(socket.read(&mut [0; 1]).unwrap(), 0);
        });
        let (sent, received) = std::sync::mpsc::channel();
        let channel = tauri::ipc::Channel::new(move |event| {
            let value: Value = event.deserialize().unwrap();
            if value["type"] == "chunk" { sent.send(()).unwrap(); }
            Ok(())
        });
        let request = model_request(&url, "test", &json!({})).unwrap();
        let handle = tauri::async_runtime::spawn(async move {
            stream_model_request(request, &channel).await
        });
        received.recv_timeout(Duration::from_secs(5)).unwrap();
        handle.abort();
        assert!(tauri::async_runtime::block_on(handle).is_err());
        server.join().unwrap();
    }

    #[test]
    fn preserves_http_errors_and_stream_bytes_without_following_redirects() {
        for (status, extra_headers, body) in [
            (200, "Content-Type: text/event-stream\r\n", "data: 中文\n\n"),
            (401, "Content-Type: application/json\r\n", "{\"error\":\"invalid key\"}"),
            (307, "Location: http://127.0.0.1:1/private\r\n", "redirect"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut reader = BufReader::new(&mut socket);
                let mut request_headers = String::new();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" { break; }
                    if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                    request_headers.push_str(&line);
                }
                let mut request_body = vec![0; length];
                reader.read_exact(&mut request_body).unwrap();
                assert!(request_headers.to_lowercase().contains("authorization: bearer test"));
                assert_eq!(serde_json::from_slice::<Value>(&request_body).unwrap(), json!({"model":"test"}));
                write!(socket, "HTTP/1.1 {} Test\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n{}", status, extra_headers, body.len(), body).unwrap();
            });
            let events = Arc::new(Mutex::new(Vec::<Value>::new()));
            let received = events.clone();
            let channel = tauri::ipc::Channel::new(move |event| {
                received.lock().unwrap().push(event.deserialize().unwrap());
                Ok(())
            });
            tauri::async_runtime::block_on(stream_model_request(
                model_request(&url, "test", &json!({"model":"test"})).unwrap(), &channel,
            )).unwrap();
            server.join().unwrap();
            let events = events.lock().unwrap();
            assert_eq!(events[0]["type"], "headers");
            assert_eq!(events[0]["status"], status);
            let bytes: Vec<u8> = events.iter().filter(|event| event["type"] == "chunk")
                .flat_map(|event| serde_json::from_value::<Vec<u8>>(event["data"].clone()).unwrap()).collect();
            assert_eq!(bytes, body.as_bytes());
            assert_eq!(events.last().unwrap()["type"], "end");
        }
    }
}

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
        .manage(ModelRequests::default())
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
        .invoke_handler(tauri::generate_handler![greet, create_notion_page, scan_git_repos, start_model_request, cancel_model_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
