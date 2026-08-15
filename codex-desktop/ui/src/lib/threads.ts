import type { ThreadSummary } from "../types";

/**
 * Finds a thread's own `cwd` across the per-Project lists.
 *
 * A thread's `cwd` is not always the selected Project's path: `thread/search`
 * spans every Project, so a thread opened from search belongs to a repository
 * the sidebar is not currently pointing at. Anything that runs a
 * repository-scoped operation for a thread must resolve the path this way and
 * treat the Project path as a fallback only.
 */
export function threadCwd(
  threadsByProject: Record<string, ThreadSummary[]>,
  threadId: string,
): string | null {
  for (const threads of Object.values(threadsByProject)) {
    const match = threads.find((thread) => thread.id === threadId);
    if (match?.cwd) return match.cwd;
  }
  return null;
}
