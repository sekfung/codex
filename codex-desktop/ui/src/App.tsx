import { MessagesSquare } from "lucide-react";

import { StoreProvider, useStore } from "./store";
import { ThemeProvider } from "./useTheme";
import { Sidebar } from "./components/Sidebar";
import { ChatStream } from "./components/ChatStream";
import { Composer } from "./components/Composer";
import { SettingsShell } from "./components/settings/SettingsShell";
import { TooltipProvider } from "@/components/ui/tooltip";

function MainPane() {
  const { state } = useStore();
  const threadId = state.activeThreadId;

  if (!threadId) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
        <MessagesSquare className="size-8 text-muted-foreground" />
        <p className="text-xl font-medium tracking-tight">Codex</p>
        <p className="text-sm text-muted-foreground">从左侧选择一个项目对话，或新建一个。</p>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <ChatStream threadId={threadId} />
      <Composer threadId={threadId} />
    </main>
  );
}

function AppShell() {
  const { state } = useStore();

  // Settings is a full-window takeover rather than a modal, matching the
  // Official App (its reference screenshots show a "返回应用" back control and
  // its own left rail, not a dialog over the conversation).
  if (state.settingsScreen !== null) {
    return <SettingsShell />;
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <MainPane />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <TooltipProvider delayDuration={300}>
          <AppShell />
        </TooltipProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}

export default App;
