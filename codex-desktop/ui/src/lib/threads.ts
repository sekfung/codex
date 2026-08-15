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

/**
 * How an agent thread is named in the UI.
 *
 * Mirrors the TUI's label order (`multi_agents.rs`): the nickname is the
 * human-friendly name, the role goes in brackets after it, and a thread with
 * neither falls back to its title. Returns null when nothing is known, so
 * callers show a generic label rather than a raw UUID.
 */
export function agentLabel(info: {
  nickname?: string | null;
  role?: string | null;
  name?: string | null;
}): string | null {
  const nickname = info.nickname?.trim();
  const role = info.role?.trim();
  if (nickname) return role ? `${nickname} [${role}]` : nickname;
  if (role) return role;
  return info.name?.trim() || null;
}
