import { OctagonAlert } from "lucide-react";

/**
 * Shown instead of the app when the embedded app-server did not start.
 *
 * Every RPC-backed command takes `State<'_, AppServerBridge>`, which is only
 * managed on a successful start (`main.rs`). Without this screen the window
 * opens and renders normally, and each action fails with Tauri's opaque
 * unmanaged-state error — an app that looks fine and does nothing. The
 * reason itself only ever reached stderr, which nobody reading a GUI sees.
 */
export function StartupFailure({ reason }: { reason: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-6 text-foreground">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <OctagonAlert className="size-8 text-destructive" />
        <p className="text-xl font-medium tracking-tight">Codex 引擎未能启动</p>
        <p className="text-sm text-muted-foreground">
          界面已加载，但后台引擎不可用，因此对话、项目和设置都无法使用。
        </p>
        <p className="w-full rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-[13px] break-words">
          {reason}
        </p>
        <p className="text-xs text-muted-foreground">
          请检查 <code className="font-mono">$CODEX_HOME</code> 下的配置后重启应用。
        </p>
      </div>
    </div>
  );
}
