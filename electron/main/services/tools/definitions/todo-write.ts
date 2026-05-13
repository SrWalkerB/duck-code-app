/**
 * TodoWrite Tool — Structured task list for the model to organize complex work.
 *
 * The model writes the FULL todo list each time (replace, not incremental).
 * Todos are stored in memory per-run and emitted to the UI via activity events.
 *
 * Inspired by claude-code's TodoWriteTool.
 */

import { z } from "zod";
import { buildTool } from "../tool.js";

// ---------------------------------------------------------------------------
// In-memory todo storage (per-run)
// ---------------------------------------------------------------------------

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

let currentTodos: TodoItem[] = [];

export function getTodos(): TodoItem[] {
  return [...currentTodos];
}

export function clearTodos(): void {
  currentTodos = [];
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const TodoWriteTool = buildTool({
  name: "todo_write",
  description: `Create or update a structured task list to track your progress on complex work.

Use this tool when:
- Working on a multi-step task (3+ steps)
- You need to organize and track progress on complex work
- The user provides multiple things to do
- You want to show the user what you're working on

How to use:
- Write the FULL todo list each time (not incremental updates)
- Mark exactly ONE task as "in_progress" at a time
- Mark tasks as "completed" immediately after finishing them
- Use imperative form for content (e.g., "Fix authentication bug")

Do NOT use for:
- Single, simple tasks
- Trivial tasks completable in <3 steps
- Purely conversational responses`,

  inputSchema: z.object({
    todos: z.array(z.object({
      content: z.string().min(1).describe("Task description in imperative form (e.g., 'Fix the login bug')"),
      status: z.enum(["pending", "in_progress", "completed"]).describe("Task status"),
    })).min(1).describe("The complete todo list (replaces the previous list)"),
  }),

  isReadOnly: true, // doesn't modify filesystem
  isConcurrencySafe: false,

  validateInput: (input) => {
    // Validate exactly 0 or 1 task is in_progress
    const inProgress = input.todos.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      return { valid: false, error: "Only one task can be in_progress at a time." };
    }
    return { valid: true };
  },

  call: async (input, ctx) => {
    const oldTodos = [...currentTodos];

    // If all completed, clear the list
    const allDone = input.todos.every((t) => t.status === "completed");
    currentTodos = allDone ? [] : input.todos;

    // Emit todo list to UI
    const summary = input.todos
      .map((t) => {
        const icon = t.status === "completed" ? "[x]"
          : t.status === "in_progress" ? "[>]"
          : "[ ]";
        return `${icon} ${t.content}`;
      })
      .join("\n");

    ctx.onActivity({
      kind: "info",
      summary: `Todo list:\n${summary}`,
    });

    // Build a concise result for the model
    const completed = input.todos.filter((t) => t.status === "completed").length;
    const pending = input.todos.filter((t) => t.status === "pending").length;
    const inProgress = input.todos.filter((t) => t.status === "in_progress").length;

    return {
      success: true,
      output: `Todo list updated: ${completed} completed, ${inProgress} in progress, ${pending} pending.${allDone ? " All tasks completed — list cleared." : ""}`,
      metadata: { total: input.todos.length, completed, inProgress, pending },
    };
  },
});
