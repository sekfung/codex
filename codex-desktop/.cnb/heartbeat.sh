#!/usr/bin/env bash
# heartbeat.sh — run a command while periodically emitting heartbeat output.
#
# CNB's Linux runner kills any stage that produces no output for 10 minutes.
# Long Rust builds (e.g. `cargo tauri build` linking the full codex workspace)
# can exceed that window during silent phases (linking, large crate compiles),
# so this wrapper keeps the log alive by printing a heartbeat line at a
# configurable interval.
#
# Usage:
#   HEARTBEAT_INTERVAL=120 heartbeat.sh cargo tauri build
#
# The child's exit code is propagated.

set -u

interval="${HEARTBEAT_INTERVAL:-60}"

"$@" &
child_pid=$!

while kill -0 "$child_pid" 2>/dev/null; do
  sleep "$interval"
  # Re-check after sleeping so we don't emit a final spurious line after the
  # child has already exited.
  if kill -0 "$child_pid" 2>/dev/null; then
    echo "[heartbeat] ${interval}s without output — build still running (pid ${child_pid})"
  fi
done

wait "$child_pid"
exit $?
