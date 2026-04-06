import { ipcMain } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../services/prisma.js";

type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type GitSummary = {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  resolvedPath: string | null;
};

function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const code =
          typeof (error as NodeJS.ErrnoException).code === "number"
            ? ((error as NodeJS.ErrnoException).code as number)
            : 1;
        resolve({ code, stdout: String(stdout || ""), stderr: String(stderr || "") });
        return;
      }
      resolve({ code: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function getGitSummary(path: string): Promise<GitSummary> {
  const isRepoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], path);
  if (isRepoCheck.code !== 0 || isRepoCheck.stdout.trim() !== "true") {
    return { isRepo: false, currentBranch: null, branches: [], resolvedPath: null };
  }

  const currentBranchRes = await runGit(["branch", "--show-current"], path);
  const currentBranch = currentBranchRes.code === 0
    ? currentBranchRes.stdout.trim() || null
    : null;

  const branchListRes = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    path
  );
  const branches = branchListRes.code === 0
    ? branchListRes.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  return {
    isRepo: true,
    currentBranch,
    branches,
    resolvedPath: path,
  };
}

async function resolveThreadWorkdir(threadId: string): Promise<string | null> {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    include: { project: { select: { path: true } } },
  });

  if (!thread?.project?.path) {
    return null;
  }

  const projectPath = thread.project.path;
  const threadFolderName = thread.title.trim();
  const candidates: string[] = [];

  if (threadFolderName) {
    const candidate = join(projectPath, threadFolderName);
    if (existsSync(candidate)) {
      candidates.push(candidate);
    }
  }

  candidates.push(projectPath);

  for (const candidate of candidates) {
    const check = await runGit(["rev-parse", "--is-inside-work-tree"], candidate);
    if (check.code === 0 && check.stdout.trim() === "true") {
      return candidate;
    }
  }

  return candidates[0] ?? null;
}

export function registerGitHandlers(): void {
  ipcMain.handle("git:summary", async (_, args: { path: string }) => {
    return getGitSummary(args.path);
  });

  ipcMain.handle("git:summary-for-thread", async (_, args: { threadId: string }) => {
    const workdir = await resolveThreadWorkdir(args.threadId);
    if (!workdir) {
      return { isRepo: false, currentBranch: null, branches: [], resolvedPath: null };
    }
    const summary = await getGitSummary(workdir);
    return {
      ...summary,
      resolvedPath: workdir,
    };
  });

  ipcMain.handle(
    "git:checkout-branch",
    async (_, args: { path: string; branch: string }) => {
      const result = await runGit(["checkout", args.branch], args.path);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "Falha ao trocar branch.");
      }
      return getGitSummary(args.path);
    }
  );

  ipcMain.handle(
    "git:checkout-branch-for-thread",
    async (_, args: { threadId: string; branch: string }) => {
      const workdir = await resolveThreadWorkdir(args.threadId);
      if (!workdir) {
        throw new Error("Diretorio da thread nao encontrado.");
      }
      const result = await runGit(["checkout", args.branch], workdir);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "Falha ao trocar branch.");
      }
      const summary = await getGitSummary(workdir);
      return {
        ...summary,
        resolvedPath: workdir,
      };
    }
  );
}
