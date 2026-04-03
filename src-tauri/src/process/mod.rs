use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub struct ProcessState(pub Mutex<HashMap<String, u32>>);

/// Data emitted with the chat:complete event
#[derive(serde::Serialize, Clone)]
pub struct CompletePayload {
    pub text: String,
    pub session_id: Option<String>,
    pub cost_usd: f64,
    pub duration_ms: u64,
}

#[derive(serde::Serialize, Clone)]
pub struct ToolUsePayload {
    pub tool_use_id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(serde::Serialize, Clone)]
pub struct ToolResultPayload {
    pub tool_use_id: String,
    pub content: String,
}

pub async fn spawn_claude<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    project_path: String,
    model: String,
    effort: String,
    session_id: Option<String>,
    message: String,
    permission_mode: String,
    process_state: tauri::State<'_, ProcessState>,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "--model".to_string(),
        model.clone(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--permission-mode".to_string(),
        permission_mode,
    ];

    if !effort.is_empty() && effort != "default" {
        args.push("--effort".to_string());
        args.push(effort);
    }

    if let Some(ref sid) = session_id {
        if !sid.is_empty() {
            args.push("--resume".to_string());
            args.push(sid.clone());
        }
    }

    args.push("-p".to_string());
    args.push(message);

    log::info!("[thread:{}] Spawning claude with model={}, args count={}", thread_id, model, args.len());

    let mut child = Command::new("claude")
        .args(&args)
        .current_dir(&project_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn claude process: {}", e))?;

    let pid = child.id().ok_or_else(|| "Failed to get process ID".to_string())?;
    log::info!("[thread:{}] Claude process started with PID {}", thread_id, pid);

    {
        let mut processes = process_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        processes.insert(thread_id.clone(), pid);
    }

    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let stream_event = format!("chat:stream:{}", thread_id);
    let done_event = format!("chat:done:{}", thread_id);
    let complete_event = format!("chat:complete:{}", thread_id);
    let error_event = format!("chat:error:{}", thread_id);
    let tool_use_event = format!("chat:tool_use:{}", thread_id);
    let tool_result_event = format!("chat:tool_result:{}", thread_id);
    let tid = thread_id.clone();

    // Capture stderr
    let stderr = child.stderr.take();

    tokio::spawn(async move {
        // Log stderr in background
        if let Some(stderr) = stderr {
            let stderr_reader = BufReader::new(stderr);
            let mut stderr_lines = stderr_reader.lines();
            let tid_err = tid.clone();
            let app_err = app_handle.clone();
            let err_evt = error_event.clone();
            tokio::spawn(async move {
                let mut error_buf = String::new();
                while let Ok(Some(line)) = stderr_lines.next_line().await {
                    log::error!("[thread:{}] stderr: {}", tid_err, line);
                    if !line.trim().is_empty() {
                        error_buf.push_str(&line);
                        error_buf.push('\n');
                    }
                }
                if !error_buf.is_empty() {
                    let _ = app_err.emit(&err_evt, error_buf.trim());
                }
            });
        }

        let mut event_count: u32 = 0;
        let mut accumulated_text = String::new();
        let mut result_session_id: Option<String> = None;
        let mut result_cost_usd: f64 = 0.0;
        let mut result_duration_ms: u64 = 0;
        let mut emitted_tool_use_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut emitted_tool_result_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            event_count += 1;

            // Parse JSON to extract text content and session_id
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");

                match event_type {
                    "assistant" => {
                        // Extract text and tool_use from content array
                        if let Some(content) = json.get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array())
                        {
                            for block in content {
                                let block_type = block.get("type").and_then(|t| t.as_str());
                                match block_type {
                                    Some("text") => {
                                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                            accumulated_text = text.to_string();
                                            log::info!("[thread:{}] Got text ({} chars)", tid, text.len());
                                        }
                                    }
                                    Some("tool_use") => {
                                        let tool_use_id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        if !tool_use_id.is_empty() && emitted_tool_use_ids.insert(tool_use_id.clone()) {
                                            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let input = block.get("input").cloned().unwrap_or(serde_json::Value::Null);
                                            log::info!("[thread:{}] Tool use: {} ({})", tid, name, tool_use_id);
                                            let _ = app_handle.emit(&tool_use_event, ToolUsePayload { tool_use_id, name, input });
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    "user" => {
                        // Extract tool_result from content array
                        if let Some(content) = json.get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array())
                        {
                            for block in content {
                                if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                                    let tool_use_id = block.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    // Only emit once per tool_use_id (reuse the same set)
                                    if !tool_use_id.is_empty() && emitted_tool_result_ids.insert(tool_use_id.clone()) {
                                        let content_str = block.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                        log::info!("[thread:{}] Tool result for {}", tid, tool_use_id);
                                        let _ = app_handle.emit(&tool_result_event, ToolResultPayload { tool_use_id, content: content_str });
                                    }
                                }
                            }
                        }
                    }
                    "result" => {
                        result_session_id = json.get("session_id")
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string());

                        result_cost_usd = json.get("total_cost_usd")
                            .and_then(|c| c.as_f64())
                            .unwrap_or(0.0);

                        result_duration_ms = json.get("duration_ms")
                            .and_then(|d| d.as_u64())
                            .unwrap_or(0);

                        if let Some(result_text) = json.get("result").and_then(|r| r.as_str()) {
                            if accumulated_text.is_empty() {
                                accumulated_text = result_text.to_string();
                            }
                        }

                        log::info!("[thread:{}] Result: session_id={:?}, cost=${:.4}, duration={}ms",
                            tid, result_session_id, result_cost_usd, result_duration_ms
                        );
                    }
                    "system" | "rate_limit_event" => {
                        // Skip logging payload for these
                        log::debug!("[thread:{}] {} event", tid, event_type);
                    }
                    _ => {
                        log::debug!("[thread:{}] {} event", tid, event_type);
                    }
                }
            }

            // Always emit the raw line to frontend
            let _ = app_handle.emit(&stream_event, &line);
        }

        let status = child.wait().await;
        log::info!("[thread:{}] Process finished. status={:?}, events={}, text_len={}",
            tid, status, event_count, accumulated_text.len());

        // Emit complete event with accumulated text, session_id, cost and duration
        let _ = app_handle.emit(&complete_event, CompletePayload {
            text: accumulated_text,
            session_id: result_session_id,
            cost_usd: result_cost_usd,
            duration_ms: result_duration_ms,
        });

        let _ = app_handle.emit(&done_event, "done");
    });

    Ok(())
}

pub fn kill_process(process_state: &ProcessState, thread_id: &str) -> Result<(), String> {
    let mut processes = process_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(pid) = processes.remove(thread_id) {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .arg(pid.to_string())
                .spawn();
        }

        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(&["/PID", &pid.to_string(), "/F"])
                .spawn();
        }

        Ok(())
    } else {
        Err("No active process for this thread".to_string())
    }
}
