use tauri::State;
use crate::db::{self, DbState};
use crate::process::{self, ProcessState};

// --- Skills types and helpers ---

#[derive(serde::Serialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub file: String,
}

#[derive(serde::Serialize)]
pub struct PluginSkills {
    pub plugin: String,
    pub skills: Vec<Skill>,
}

fn parse_frontmatter(content: &str) -> (String, String) {
    if !content.starts_with("---") {
        return (String::new(), String::new());
    }
    let rest = &content[3..];
    let end = rest.find("\n---").unwrap_or(rest.len());
    let fm = &rest[..end];
    let mut name = String::new();
    let mut description = String::new();
    for line in fm.lines() {
        if let Some(val) = line.strip_prefix("name:") {
            name = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().to_string();
        }
    }
    (name, description)
}

fn read_skills_from_dir(skills_dir: &std::path::Path) -> Vec<Skill> {
    let mut skills = Vec::new();
    let Ok(entries) = std::fs::read_dir(skills_dir) else { return skills };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name();
        let file_str = file_name.to_string_lossy().to_string();
        if path.is_file() && file_str.ends_with(".md") {
            let stem = file_str.trim_end_matches(".md").to_string();
            if let Ok(content) = std::fs::read_to_string(&path) {
                let (fm_name, fm_desc) = parse_frontmatter(&content);
                // Skip files with no frontmatter (internal/helper files)
                if fm_name.is_empty() && fm_desc.is_empty() {
                    continue;
                }
                skills.push(Skill {
                    name: if fm_name.is_empty() { stem } else { fm_name },
                    description: fm_desc,
                    file: file_str,
                });
            }
        } else if path.is_dir() {
            let stem = file_str.clone();
            // Check <dirname>.md, then SKILL.md, then any .md with frontmatter
            let candidate = path.join(format!("{}.md", stem));
            let skill_md = path.join("SKILL.md");
            let md_path = if candidate.exists() {
                Some(candidate)
            } else if skill_md.exists() {
                Some(skill_md)
            } else {
                std::fs::read_dir(&path).ok().and_then(|sub_entries| {
                    sub_entries.flatten().find_map(|e| {
                        let p = e.path();
                        if p.extension().map(|x| x == "md").unwrap_or(false) {
                            Some(p)
                        } else {
                            None
                        }
                    })
                })
            };
            if let Some(md) = md_path {
                if let Ok(content) = std::fs::read_to_string(&md) {
                    let (fm_name, fm_desc) = parse_frontmatter(&content);
                    skills.push(Skill {
                        name: if fm_name.is_empty() { stem.clone() } else { fm_name },
                        description: fm_desc,
                        file: format!(
                            "{}/{}",
                            stem,
                            md.file_name().unwrap_or_default().to_string_lossy()
                        ),
                    });
                }
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

// --- Project commands ---

#[tauri::command]
pub async fn create_project(
    name: String,
    path: String,
    color: String,
    db_state: State<'_, DbState>,
) -> Result<db::Project, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::create_project(&conn, &name, &path, &color)
}

#[tauri::command]
pub async fn list_projects(
    db_state: State<'_, DbState>,
) -> Result<Vec<db::Project>, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::list_projects(&conn)
}

#[tauri::command]
pub async fn update_project(
    id: String,
    name: Option<String>,
    color: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<db::Project, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::update_project(&conn, &id, name.as_deref(), color.as_deref())
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::delete_project(&conn, &id)
}

// --- Thread commands ---

#[tauri::command]
pub async fn create_thread(
    project_id: String,
    title: String,
    model: String,
    reasoning: String,
    db_state: State<'_, DbState>,
) -> Result<db::Thread, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::create_thread(&conn, &project_id, &title, &model, &reasoning)
}

#[tauri::command]
pub async fn list_threads(
    project_id: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<db::Thread>, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::list_threads(&conn, &project_id)
}

#[tauri::command]
pub async fn update_thread(
    id: String,
    title: Option<String>,
    model: Option<String>,
    reasoning: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<db::Thread, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::update_thread(&conn, &id, title.as_deref(), model.as_deref(), reasoning.as_deref())
}

#[tauri::command]
pub async fn delete_thread(
    id: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::delete_thread(&conn, &id)
}

// --- Message commands ---

#[tauri::command]
pub async fn list_messages(
    thread_id: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<db::Message>, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    db::list_messages(&conn, &thread_id)
}

// --- Save assistant message ---

#[tauri::command]
pub async fn save_assistant_message(
    thread_id: String,
    content: String,
    session_id: Option<String>,
    metadata: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<db::Message, String> {
    let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    let msg = db::create_message(&conn, &thread_id, "assistant", &content, metadata.as_deref())?;

    // Update session_id on the thread if provided
    if let Some(sid) = session_id {
        if !sid.is_empty() {
            db::update_thread_session(&conn, &thread_id, &sid)?;
        }
    }

    Ok(msg)
}

// --- Dialog commands ---

#[tauri::command]
pub async fn pick_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app_handle
        .dialog()
        .file()
        .pick_folder(move |folder_path| {
            let _ = tx.send(folder_path.map(|p| p.to_string()));
        });
    rx.recv()
        .map_err(|e| format!("Dialog error: {}", e))
}

// --- Chat commands ---

#[tauri::command]
pub async fn send_message(
    thread_id: String,
    content: String,
    permission_mode: Option<String>,
    app_handle: tauri::AppHandle,
    db_state: State<'_, DbState>,
    process_state: State<'_, ProcessState>,
) -> Result<db::Message, String> {
    // Save the user message
    let (user_msg, thread_model, thread_reasoning, thread_session_id, project_path) = {
        let conn = db_state.0.lock().map_err(|e| format!("Lock error: {}", e))?;

        let msg = db::create_message(&conn, &thread_id, "user", &content, None)?;

        let thread = db::get_thread(&conn, &thread_id)?;
        let project = db::get_project(&conn, &thread.project_id)?;

        (msg, thread.model, thread.reasoning, thread.session_id, project.path)
    };

    let mode = permission_mode.unwrap_or_else(|| "acceptEdits".to_string());

    // Spawn the claude process (non-blocking)
    process::spawn_claude(
        app_handle,
        thread_id,
        project_path,
        thread_model,
        thread_reasoning,
        thread_session_id,
        content,
        mode,
        process_state,
    )
    .await?;

    Ok(user_msg)
}

#[tauri::command]
pub async fn stop_generation(
    thread_id: String,
    process_state: State<'_, ProcessState>,
) -> Result<(), String> {
    process::kill_process(&process_state, &thread_id)
}

#[tauri::command]
pub async fn list_skills() -> Result<Vec<PluginSkills>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME não definido".to_string())?;
    let home_path = std::path::PathBuf::from(&home);
    let mut result: Vec<PluginSkills> = Vec::new();

    // 1. User skills from ~/.claude/skills/
    let user_skills_dir = home_path.join(".claude").join("skills");
    if user_skills_dir.exists() {
        let skills = read_skills_from_dir(&user_skills_dir);
        if !skills.is_empty() {
            result.push(PluginSkills { plugin: "user".to_string(), skills });
        }
    }

    // 2. Plugin skills via installed_plugins.json (same source of truth as Claude Code CLI)
    let manifest_path = home_path.join(".claude").join("plugins").join("installed_plugins.json");
    if !manifest_path.exists() {
        return Ok(result);
    }

    let manifest_str = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Erro ao ler manifest: {}", e))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Erro ao parsear manifest: {}", e))?;

    let Some(plugins) = manifest["plugins"].as_object() else {
        return Ok(result);
    };

    let mut plugin_map: std::collections::BTreeMap<String, Vec<Skill>> =
        std::collections::BTreeMap::new();

    for (key, entries) in plugins {
        // key format: "superpowers@claude-plugins-official"
        let plugin_name = key.split('@').next().unwrap_or(key.as_str()).to_string();
        // Use the last entry (most recently installed version)
        if let Some(install_path) = entries
            .as_array()
            .and_then(|arr| arr.last())
            .and_then(|e| e["installPath"].as_str())
        {
            let skills_dir = std::path::PathBuf::from(install_path).join("skills");
            if skills_dir.exists() {
                let skills = read_skills_from_dir(&skills_dir);
                if !skills.is_empty() {
                    plugin_map.entry(plugin_name).or_default().extend(skills);
                }
            }
        }
    }

    for (plugin, mut skills) in plugin_map {
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        result.push(PluginSkills { plugin, skills });
    }

    Ok(result)
}

// --- File Explorer commands ---

#[derive(serde::Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in dir.flatten() {
        let metadata = entry.metadata().unwrap_or_else(|_| std::fs::metadata(entry.path()).unwrap());
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common ignored directories
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }

        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    entries.sort_by(|a, b| {
        // Directories first, then alphabetical
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    // Limit to 1MB to prevent loading huge files
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    if metadata.len() > 1_048_576 {
        return Err("File too large (>1MB)".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

// --- Git commands ---

#[derive(serde::Serialize)]
pub struct GitStatusEntry {
    pub status: String,
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

fn run_git_command(project_path: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_status(project_path: String) -> Result<Vec<GitStatusEntry>, String> {
    let output = run_git_command(&project_path, &["status", "--porcelain"])?;
    let entries: Vec<GitStatusEntry> = output
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let status = line[..2].trim().to_string();
            let path = line[3..].to_string();
            GitStatusEntry { status, path }
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn git_diff(project_path: String, file_path: Option<String>) -> Result<String, String> {
    let mut args = vec!["diff"];
    if let Some(ref fp) = file_path {
        args.push("--");
        args.push(fp);
    }
    run_git_command(&project_path, &args)
}

#[tauri::command]
pub async fn git_log(project_path: String, count: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let n = count.unwrap_or(20).to_string();
    let output = run_git_command(&project_path, &[
        "log",
        &format!("-{}", n),
        "--format=%H|||%s|||%an|||%ar",
    ])?;

    let entries: Vec<GitLogEntry> = output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, "|||").collect();
            if parts.len() == 4 {
                Some(GitLogEntry {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    date: parts[3].to_string(),
                })
            } else {
                None
            }
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn git_branches(project_path: String) -> Result<Vec<String>, String> {
    let output = run_git_command(&project_path, &["branch", "--format=%(refname:short)"])?;
    Ok(output.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect())
}

#[tauri::command]
pub async fn get_claude_version() -> Result<String, String> {
    let output = std::process::Command::new("claude")
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to get claude version: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
