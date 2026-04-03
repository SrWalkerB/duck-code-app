use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Serialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Thread {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub model: String,
    pub reasoning: String,
    pub session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<String>,
    pub created_at: i64,
}

pub fn init_db(app_handle: &AppHandle) -> Result<Connection, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let db_path = app_dir.join("duck-codex.db");
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            color TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
            reasoning TEXT NOT NULL DEFAULT 'medium',
            session_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        );
        PRAGMA foreign_keys = ON;"
    )
    .map_err(|e| format!("Failed to create tables: {}", e))?;

    Ok(conn)
}

// --- Project CRUD ---

pub fn create_project(conn: &Connection, name: &str, path: &str, color: &str) -> Result<Project, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO projects (id, name, path, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, name, path, color, now, now],
    )
    .map_err(|e| format!("Failed to create project: {}", e))?;

    Ok(Project { id, name: name.to_string(), path: path.to_string(), color: color.to_string(), created_at: now, updated_at: now })
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, path, color, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query projects: {}", e))?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| format!("Failed to read project row: {}", e))?);
    }
    Ok(projects)
}

pub fn update_project(conn: &Connection, id: &str, name: Option<&str>, color: Option<&str>) -> Result<Project, String> {
    let now = chrono::Utc::now().timestamp();

    let mut sets = vec!["updated_at = ?1"];
    let mut param_idx = 2;

    if name.is_some() {
        sets.push("name = ?2");
        param_idx = 3;
    }
    if color.is_some() {
        if param_idx == 2 {
            sets.push("color = ?2");
        } else {
            sets.push("color = ?3");
        }
    }

    let sql = format!("UPDATE projects SET {} WHERE id = ?{}", sets.join(", "), param_idx);

    // Build params dynamically
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(n) = name { params_vec.push(Box::new(n.to_string())); }
    if let Some(c) = color { params_vec.push(Box::new(c.to_string())); }
    params_vec.push(Box::new(id.to_string()));

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let updated = conn
        .execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to update project: {}", e))?;

    if updated == 0 {
        return Err("Project not found".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, name, path, color, created_at, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row(params![id], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })
    .map_err(|e| format!("Failed to read updated project: {}", e))
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?1)", params![id])
        .map_err(|e| format!("Failed to delete project messages: {}", e))?;
    conn.execute("DELETE FROM threads WHERE project_id = ?1", params![id])
        .map_err(|e| format!("Failed to delete project threads: {}", e))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete project: {}", e))?;
    Ok(())
}

// --- Thread CRUD ---

pub fn create_thread(conn: &Connection, project_id: &str, title: &str, model: &str, reasoning: &str) -> Result<Thread, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO threads (id, project_id, title, model, reasoning, session_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)",
        params![id, project_id, title, model, reasoning, now, now],
    )
    .map_err(|e| format!("Failed to create thread: {}", e))?;

    Ok(Thread {
        id,
        project_id: project_id.to_string(),
        title: title.to_string(),
        model: model.to_string(),
        reasoning: reasoning.to_string(),
        session_id: None,
        created_at: now,
        updated_at: now,
    })
}

pub fn list_threads(conn: &Connection, project_id: &str) -> Result<Vec<Thread>, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, model, reasoning, session_id, created_at, updated_at FROM threads WHERE project_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(Thread {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                model: row.get(3)?,
                reasoning: row.get(4)?,
                session_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query threads: {}", e))?;

    let mut threads = Vec::new();
    for row in rows {
        threads.push(row.map_err(|e| format!("Failed to read thread row: {}", e))?);
    }
    Ok(threads)
}

pub fn get_thread(conn: &Connection, id: &str) -> Result<Thread, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, model, reasoning, session_id, created_at, updated_at FROM threads WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row(params![id], |row| {
        Ok(Thread {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            model: row.get(3)?,
            reasoning: row.get(4)?,
            session_id: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|e| format!("Thread not found: {}", e))
}

pub fn update_thread(conn: &Connection, id: &str, title: Option<&str>, model: Option<&str>, reasoning: Option<&str>) -> Result<Thread, String> {
    let now = chrono::Utc::now().timestamp();

    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(t) = title { sets.push(format!("title = ?{}", params_vec.len() + 1)); params_vec.push(Box::new(t.to_string())); }
    if let Some(m) = model { sets.push(format!("model = ?{}", params_vec.len() + 1)); params_vec.push(Box::new(m.to_string())); }
    if let Some(r) = reasoning { sets.push(format!("reasoning = ?{}", params_vec.len() + 1)); params_vec.push(Box::new(r.to_string())); }

    params_vec.push(Box::new(id.to_string()));
    let sql = format!("UPDATE threads SET {} WHERE id = ?{}", sets.join(", "), params_vec.len());

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let updated = conn
        .execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to update thread: {}", e))?;

    if updated == 0 {
        return Err("Thread not found".to_string());
    }

    get_thread(conn, id)
}

pub fn update_thread_session(conn: &Connection, id: &str, session_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE threads SET session_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![session_id, now, id],
    )
    .map_err(|e| format!("Failed to update thread session: {}", e))?;
    Ok(())
}

pub fn delete_thread(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM messages WHERE thread_id = ?1", params![id])
        .map_err(|e| format!("Failed to delete thread messages: {}", e))?;
    conn.execute("DELETE FROM threads WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete thread: {}", e))?;
    Ok(())
}

// --- Message CRUD ---

pub fn create_message(conn: &Connection, thread_id: &str, role: &str, content: &str, metadata: Option<&str>) -> Result<Message, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO messages (id, thread_id, role, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, thread_id, role, content, metadata, now],
    )
    .map_err(|e| format!("Failed to create message: {}", e))?;

    Ok(Message {
        id,
        thread_id: thread_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        metadata: metadata.map(|s| s.to_string()),
        created_at: now,
    })
}

pub fn list_messages(conn: &Connection, thread_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare("SELECT id, thread_id, role, content, metadata, created_at FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map(params![thread_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                metadata: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query messages: {}", e))?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| format!("Failed to read message row: {}", e))?);
    }
    Ok(messages)
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Project, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, path, color, created_at, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row(params![id], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })
    .map_err(|e| format!("Project not found: {}", e))
}
