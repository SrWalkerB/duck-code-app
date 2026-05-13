/**
 * File State Cache — tracks which files have been read and when.
 *
 * Used by edit_file and write_file to enforce read-before-write and
 * detect stale edits (file modified externally since last read).
 *
 * Inspired by claude-code's readFileState pattern.
 */

export interface FileState {
  content: string;
  /** File mtime at the time of the read (Date.now() if stat unavailable) */
  timestamp: number;
}

const fileStateMap = new Map<string, FileState>();

/** Record that a file was read. Called by read_file after a successful read. */
export function recordFileRead(absolutePath: string, content: string, mtimeMs: number): void {
  fileStateMap.set(absolutePath, { content, timestamp: mtimeMs });
}

/** Get the cached state for a file, or undefined if never read in this run. */
export function getFileState(absolutePath: string): FileState | undefined {
  return fileStateMap.get(absolutePath);
}

/** Update the cache after a write/edit. */
export function updateFileState(absolutePath: string, content: string, mtimeMs: number): void {
  fileStateMap.set(absolutePath, { content, timestamp: mtimeMs });
}

/** Clear the cache. Called at the beginning of each tool run. */
export function clearFileState(): void {
  fileStateMap.clear();
}
