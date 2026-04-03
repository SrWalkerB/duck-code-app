export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

