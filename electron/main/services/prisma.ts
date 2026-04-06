import { PrismaClient } from "@prisma/client";
import { app } from "electron";
import { join } from "path";

const dbPath = join(app.getPath("userData"), "duck-codex.db");
const dbUrl = `file:${dbPath}`;

process.env.DATABASE_URL = dbUrl;

export const prisma = new PrismaClient({
  datasourceUrl: dbUrl,
});

/**
 * Ensure the database schema exists.
 * Uses Prisma's internal migration for SQLite.
 */
export async function ensureDatabase(): Promise<void> {
  // Create tables if they don't exist using raw SQL
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT NOT NULL DEFAULT 'gpt-5.1-codex-mini',
      effort TEXT NOT NULL DEFAULT 'medium',
      session_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Add approval_mode column if missing (migration for existing DBs)
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE threads ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'suggest'`
    );
  } catch {
    // Column already exists
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `);

  // Drop and recreate tool_logs to ensure correct column types
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS tool_logs`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE tool_logs (
      id        TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id    TEXT NOT NULL,
      type      TEXT NOT NULL,
      content   TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tool_logs_thread_id ON tool_logs(thread_id)
  `);
}
