/**
 * Bash Tool — Execute shell commands in the project directory
 *
 * Inspired by OpenCode's bash.ts:
 * - Configurable timeout (default 2 minutes)
 * - Description field for clarity
 * - Abort signal support with graceful SIGTERM → SIGKILL
 * - Output truncation for large outputs
 * - Streaming via spawn (not buffered execFile)
 */

import { z } from "zod";
import { spawn } from "node:child_process";
import { buildTool, resolveSafe, type PermissionDecision, type ToolUseContext } from "../tool.js";

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT_CHARS = 30_000; // Truncate large outputs
const KILL_GRACE_MS = 3_000; // Grace period before SIGKILL

export const BashTool = buildTool({
  name: "bash",
  description: `Execute a shell command in the project directory.
- Use for running builds, tests, installs, git commands, etc.
- Default timeout is 2 minutes — use timeout param for longer commands
- Provide a clear description of what the command does
- Prefer this over manual file operations when a CLI tool exists`,

  inputSchema: z.object({
    command: z.string().min(1).describe("Shell command to execute"),
    description: z.string().min(1).describe("Clear description of what this command does (5-10 words)"),
    timeout: z.number().int().positive().optional().describe("Timeout in milliseconds (default 120000)"),
    cwd: z.string().optional().describe("Working directory relative to project root"),
  }),

  isReadOnly: false,
  isConcurrencySafe: false,

  // Always ask for approval except in full-auto mode
  checkPermissions: (
    input: { command: string; description: string },
    ctx: ToolUseContext,
  ): PermissionDecision => {
    if (ctx.approvalMode === "full-auto") return { behavior: "allow" };
    return { behavior: "ask", description: `Run: ${input.command}` };
  },

  call: async (input, ctx) => {
    const cwd = input.cwd
      ? resolveSafe(ctx.projectPath, input.cwd)
      : ctx.projectPath;
    const timeout = input.timeout ?? DEFAULT_TIMEOUT;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      let timedOut = false;

      const shell = process.platform === "win32" ? "cmd" : "/bin/sh";
      const shellArgs =
        process.platform === "win32"
          ? ["/c", input.command]
          : ["-c", input.command];

      const proc = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      // --- Abort signal ---
      const onAbort = () => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, KILL_GRACE_MS);
      };

      if (ctx.signal) {
        if (ctx.signal.aborted) {
          onAbort();
        } else {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      // --- Timeout ---
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, KILL_GRACE_MS);
      }, timeout);

      // --- Collect output ---
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);

        let output = [stdout, stderr].filter(Boolean).join("\n").trim();

        // Truncate large output
        if (output.length > MAX_OUTPUT_CHARS) {
          output =
            output.slice(0, MAX_OUTPUT_CHARS) +
            `\n... (output truncated, showing first ${MAX_OUTPUT_CHARS} chars)`;
        }

        // Append status tags
        if (timedOut) {
          output += `\n[TIMEOUT after ${timeout}ms]`;
        }
        if (killed && !timedOut) {
          output += "\n[CANCELLED by user]";
        }

        const success = code === 0 && !timedOut && !killed;

        resolve({
          success,
          output: output || (success ? "(no output)" : `Exit code: ${code}`),
          metadata: { exitCode: code, timedOut, killed },
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: `Failed to start process: ${err.message}`,
        });
      });
    });
  },
});
