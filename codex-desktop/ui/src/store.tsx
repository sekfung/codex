import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";
import * as api from "./api";
import type {
  ApprovalMode,
  ComposerAttachment,
  ComposerFileRef,
  ComposerMention,
  ComposerSkill,
  Personality,
  ModelSelection,
  PendingLogin,
  ReviewDelivery,
  ReviewTargetInput,
  SettingEdit,
  SkillMetadata,
  ThreadGoalStatus,
  ThreadTokenUsage,
  TokenBudgetEdit,
  TurnSubmission,
} from "./types";
import { initialState, reducer } from "./store/reducer";
import type { Action, State, ThreadState } from "./store/reducer";
import { handleEvent, pushNotice, tracingWarn } from "./store/events";

// Re-exported: components import the thread shape from `./store`, and the
// split is an internal reorganisation rather than a change to that surface.
export type { ThreadState } from "./store/reducer";
interface StoreValue {
  state: State;
  dispatch: React.Dispatch<Action>;
  setActiveProject: (path: string | null) => Promise<void>;
  setActiveThread: (threadId: string | null) => Promise<void>;
  addProject: (path: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  startNewThread: (cwd: string) => Promise<void>;
  sendMessage: (
    threadId: string,
    text: string,
    attachments?: ComposerAttachment[],
    skills?: ComposerSkill[],
    fileRefs?: ComposerFileRef[],
    mentions?: ComposerMention[],
  ) => Promise<void>;
  /**
   * The composer's submit. Returns which path the engine took (steered into
   * the running turn, started a new one, or queued behind a turn that
   * refuses steering) so the UI can say what happened.
   */
  submitMessage: (
    threadId: string,
    text: string,
    attachments?: ComposerAttachment[],
    skills?: ComposerSkill[],
    fileRefs?: ComposerFileRef[],
    mentions?: ComposerMention[],
  ) => Promise<TurnSubmission>;
  /** `thread/revert` — conversation history only; files stay as written. */
  revertThread: (threadId: string, beforeTurnId: string) => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  startReview: (
    threadId: string,
    target: ReviewTargetInput,
    delivery: ReviewDelivery,
  ) => Promise<void>;
  refetchSkills: () => void;
  refetchFeatures: () => void;
  forkThreadFromTurn: (threadId: string, turnId: string) => Promise<void>;
  /**
   * Queue (`thread/queue/*`). `queueMessage` is what the composer calls while
   * a turn is running; the engine dispatches queued work itself when the turn
   * ends, so nothing here schedules it. `startQueuedNow` is the manual escape
   * hatch for the one case the engine skips — after an interrupt.
   */
  queueMessage: (
    threadId: string,
    text: string,
    attachments?: ComposerAttachment[],
    skills?: ComposerSkill[],
    fileRefs?: ComposerFileRef[],
    mentions?: ComposerMention[],
  ) => Promise<void>;
  refetchQueue: (threadId: string) => Promise<void>;
  editQueued: (threadId: string, queuedSubmissionId: string, text: string) => Promise<void>;
  removeQueued: (threadId: string, queuedSubmissionId: string) => Promise<void>;
  moveQueued: (threadId: string, queuedSubmissionId: string, delta: number) => Promise<void>;
  startQueuedNow: (threadId: string, queuedSubmissionId?: string) => Promise<void>;
  /** Background terminals (`thread/backgroundTerminals/*`). */
  refetchBackgroundTerminals: (threadId: string) => Promise<void>;
  terminateBackgroundTerminal: (threadId: string, processId: string) => Promise<void>;
  cleanBackgroundTerminals: (threadId: string) => Promise<void>;
  /** Thread goal (`thread/goal/*`). */
  refetchGoal: (threadId: string) => Promise<void>;
  setGoal: (
    threadId: string,
    objective?: string | null,
    status?: ThreadGoalStatus | null,
    tokenBudget?: TokenBudgetEdit | null,
  ) => Promise<void>;
  clearGoal: (threadId: string) => Promise<void>;
  /**
   * Thread management. Each is a thin call onto a `thread/*` RPC (ADR-0021);
   * the resulting list changes arrive as server notifications rather than
   * being assumed locally.
   */
  renameThread: (threadId: string, name: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  unarchiveThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  setArchivedVisible: (projectPath: string, visible: boolean) => Promise<void>;
  setSearchTerm: (term: string) => void;
  exitSearch: () => void;
  setApprovalMode: (mode: ApprovalMode) => Promise<void>;
  setModelSelection: (selection: ModelSelection) => Promise<void>;
  setCollaborationMode: (mode: string) => Promise<void>;
  setPersonality: (personality: Personality) => Promise<void>;
  interruptActiveTurn: (threadId: string) => Promise<void>;
  openSettings: (screen?: string) => void;
  closeSettings: () => void;
  /**
   * Settings-screen writers (ADR-0020): these persist to `config.toml`,
   * unlike their composer counterparts above which are session-only.
   */
  setDefaultApprovalMode: (mode: ApprovalMode) => Promise<void>;
  writeSetting: (edit: SettingEdit) => Promise<void>;
  reloadConfig: () => Promise<void>;
  /**
   * Account sign-in / sign-out (账户 screen). Read-only elsewhere: this app
   * has no billing, upgrade or credit-purchase path anywhere.
   */
  startLogin: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAccount: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

// Deltas that append to an item's `text`. All carry `delta` plus the
// `threadId`/`turnId`/`itemId` correlation key.
//
// `item/commandExecution/outputDelta` is deliberately *not* here: it appends to
// `aggregatedOutput` rather than `text`, so it gets its own action
// (`ITEM_OUTPUT_DELTA`) below.

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeProjectPathRef = useRef<string | null>(null);
  activeProjectPathRef.current = state.activeProjectPath;
  /**
   * Skills are scanned per-cwd, so `skills/list` gets every open Project
   * rather than only the active one — a `$mention` should resolve the same
   * way regardless of which Project is selected when you type it.
   */
  const projectPathsRef = useRef<string[]>([]);
  projectPathsRef.current = state.projects.map((project) => project.path);
  // Read inside callbacks that must not re-create on every thread-state
  // change (they'd otherwise re-run effects that depend on their identity).
  const threadsRef = useRef<Record<string, ThreadState>>({});
  threadsRef.current = state.threads;
  const approvalModeRef = useRef<ApprovalMode>(initialState.approvalMode);
  approvalModeRef.current = state.approvalMode;
  const activeThreadIdRef = useRef<string | null>(null);
  activeThreadIdRef.current = state.activeThreadId;

  const modelSelectionRef = useRef<ModelSelection>(initialState.modelSelection);
  modelSelectionRef.current = state.modelSelection;
  const collaborationModeRef = useRef<string>(initialState.collaborationMode);
  collaborationModeRef.current = state.collaborationMode;
  const personalityRef = useRef<Personality | null>(initialState.personality);
  personalityRef.current = state.personality;
  // Read at call time so cancelling targets the login that is actually in
  // flight, not one captured when the callback was created.
  const pendingLoginRef = useRef<PendingLogin | null>(null);
  pendingLoginRef.current = state.pendingLogin;

  useEffect(() => {
    api
      .listProjects()
      .then((projects) => dispatch({ type: "PROJECTS_LOADED", projects }))
      // The pinned Project list is this app's own state (ADR-0012) and the
      // sidebar's whole content. Failing silently is indistinguishable from
      // "you have never opened a Project", which would invite the user to
      // re-add Projects they already have.
      .catch((error) =>
        pushNotice(dispatch, {
          severity: "error",
          source: "list_projects",
          message: "无法读取项目列表",
          details: String(error),
        }),
      );
  }, []);

  useEffect(() => {
    api
      .listModels()
      .then((response) => dispatch({ type: "MODELS_LOADED", models: response.data ?? [] }))
      // A missing catalog leaves the picker empty rather than breaking the
      // composer; threads then run at whatever the server defaults to.
      .catch((error) => tracingWarn(`model/list failed: ${String(error)}`));
  }, []);

  useEffect(() => {
    api
      .listCollaborationModes()
      .then((modes) => dispatch({ type: "COLLABORATION_MODES_LOADED", modes }))
      // `collaborationMode/list` is experimental. If it is unavailable the `@`
      // menu simply omits 计划模式 rather than offering a mode it cannot set.
      .catch((error) => tracingWarn(`collaborationMode/list failed: ${String(error)}`));
  }, []);

  useEffect(() => {
    api
      .listFeatures()
      .then((features) => dispatch({ type: "FEATURES_LOADED", features }))
      // Gating is advisory: on failure the list stays empty and consumers fall
      // back to their own secondary checks, rather than hiding every gated
      // control because one lookup failed.
      .catch((error) => tracingWarn(`experimentalFeature/list failed: ${String(error)}`));
  }, []);

  /**
   * Loads `config.toml` and seeds the session's approval mode / model from
   * the persisted defaults (ADR-0020). Also used to refresh after a write, so
   * the screens always show the server's view rather than an optimistic one.
   */
  const reloadConfig = useCallback(async () => {
    const [read, defaultApprovalMode] = await Promise.all([
      api.readConfig(),
      // Mapped in Rust so the forward/reverse approval-mode mapping stays in
      // one place; `null` means "config isn't one of the three presets".
      api.readDefaultApprovalMode(),
    ]);
    dispatch({
      type: "CONFIG_LOADED",
      config: read.config ?? {},
      origins: read.origins ?? {},
      defaultApprovalMode,
    });
  }, []);

  useEffect(() => {
    // Config failing to load leaves the app on its built-in defaults rather
    // than blocking startup; the settings screens surface the error.
    reloadConfig().catch((error) => tracingWarn(`config/read failed: ${String(error)}`));
    api
      .readConfigRequirements()
      .then((response) =>
        dispatch({
          type: "CONFIG_REQUIREMENTS_LOADED",
          requirements: response.requirements ?? null,
        }),
      )
      .catch((error) => tracingWarn(`configRequirements/read failed: ${String(error)}`));
  }, [reloadConfig]);

  /**
   * Read-only account state for the sidebar footer. A failure here leaves the
   * footer showing nothing identifying rather than blocking the app — being
   * signed in is not a precondition for the UI to render.
   */
  const refetchAccount = useCallback(() => {
    api
      .readAccount()
      .then((response) =>
        dispatch({
          type: "ACCOUNT_LOADED",
          account: response.account ?? null,
          requiresOpenaiAuth: response.requiresOpenaiAuth ?? false,
        }),
      )
      .catch((error) => tracingWarn(`account/read failed: ${String(error)}`));
  }, []);

  /**
   * `skills/list` across the open Projects, so repo-local skills resolve.
   * A failure leaves the catalog empty: `$` then simply matches nothing,
   * which is the same experience as having no skills installed.
   */
  const refetchSkills = useCallback(() => {
    const cwds = projectPathsRef.current;
    api
      .listSkills(cwds)
      .then((response) => {
        // One entry per cwd, each with its own skills; the composer wants a
        // flat list. De-duplicate by path, since a skill visible from two
        // Projects is one skill.
        const byPath = new Map<string, SkillMetadata>();
        for (const entry of response.data ?? []) {
          for (const skill of entry.skills ?? []) {
            // Disabled skills are kept: the settings screen needs them to
            // offer re-enabling. The typeahead filters them out itself.
            byPath.set(skill.path, skill);
          }
        }
        dispatch({ type: "SKILLS_LOADED", skills: [...byPath.values()] });
      })
      .catch((error) => tracingWarn(`skills/list failed: ${String(error)}`));
  }, []);

  /**
   * Re-reads the feature table after a toggle.
   *
   * The write is a config edit, and a higher config layer can pin a flag, so
   * the effective value is the server's to report rather than ours to assume.
   */
  const refetchFeatures = useCallback(() => {
    api
      .listFeatures()
      .then((features) => dispatch({ type: "FEATURES_LOADED", features }))
      .catch((error) => tracingWarn(`experimentalFeature/list failed: ${String(error)}`));
  }, []);

  /**
   * `app/list` for the `@` menu's 插件 section.
   *
   * A failure leaves the catalog empty, so the section simply does not
   * appear — the same outcome as having no connectors, and better than a
   * section that lists apps this build cannot actually mention.
   */
  const refetchApps = useCallback(() => {
    api
      .listApps()
      .then((response) => dispatch({ type: "APPS_LOADED", apps: response.data ?? [] }))
      .catch((error) => tracingWarn(`app/list failed: ${String(error)}`));
  }, []);

  /**
   * Corrects the composer's indicators from `thread/settings/updated`. Also
   * fires for this client's own writes, so the indicator reflects what the
   * server actually applied rather than what was optimistically requested.
   */
  const applyThreadSettings = useCallback((threadId: string, settings: unknown) => {
    api
      .threadSettingsIndicators(settings)
      .then((indicators) =>
        dispatch({ type: "THREAD_SETTINGS_APPLIED", threadId, indicators }),
      )
      .catch((error) => tracingWarn(`thread/settings/updated mapping failed: ${String(error)}`));
  }, []);

  const computeContextUsage = useCallback((threadId: string, usage: ThreadTokenUsage) => {
    api
      .contextUsage(
        usage.last?.totalTokens ?? 0,
        usage.total?.totalTokens ?? 0,
        usage.modelContextWindow ?? null,
      )
      .then((contextUsage) =>
        dispatch({ type: "CONTEXT_USAGE_COMPUTED", threadId, contextUsage }),
      )
      .catch((error) => tracingWarn(`context usage computation failed: ${String(error)}`));
  }, []);

  /**
   * Defined here rather than with the other queue actions because
   * `thread/queue/changed` needs it: the engine mutates the queue on its own
   * (it dispatches the head on turn completion), so a re-list is the only way
   * to stay truthful.
   */
  const refetchQueue = useCallback(async (threadId: string) => {
    const queue = await api.queueList(threadId);
    dispatch({ type: "QUEUE_LOADED", threadId, queue });
  }, []);

  // Re-listed whenever the Project set changes, not just at mount: skills are
  // scanned per-cwd, and at mount the Project list has usually not loaded yet,
  // so a mount-only fetch would only ever see the session cwd.
  useEffect(() => {
    refetchSkills();
  }, [refetchSkills, state.projects]);

  // Apps are account-scoped rather than per-cwd, so unlike skills this only
  // needs fetching once; `app/list/updated` keeps it current afterwards.
  useEffect(() => {
    refetchApps();
  }, [refetchApps]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onAppServerEvent((envelope) =>
        handleEvent(envelope, dispatch, {
          refetchAccount,
          refetchSkills,
          refetchApps,
          computeContextUsage,
          applyThreadSettings,
          refetchQueue: (threadId) => {
            refetchQueue(threadId).catch((error) =>
              tracingWarn(`thread/queue/list failed: ${String(error)}`),
            );
          },
        }),
      )
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [
    refetchAccount,
    refetchSkills,
    refetchApps,
    computeContextUsage,
    applyThreadSettings,
    refetchQueue,
  ]);

  useEffect(() => {
    refetchAccount();
    api
      .readAccountRateLimits()
      .then((response) =>
        dispatch({ type: "RATE_LIMITS_LOADED", rateLimits: response.rateLimits }),
      )
      .catch((error) => tracingWarn(`account/rateLimits/read failed: ${String(error)}`));
  }, [refetchAccount]);

  // Debounced search. Runs off the committed term rather than per keystroke,
  // and a stale in-flight response is discarded so fast typing can't let an
  // earlier query overwrite a later one.
  const searchTerm = state.search.term;
  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      dispatch({ type: "SEARCH_SUCCEEDED", results: [] });
      return;
    }
    let cancelled = false;
    dispatch({ type: "SEARCH_STARTED" });
    const timer = setTimeout(() => {
      api
        .searchThreads(term, 40)
        .then((response) => {
          if (!cancelled) {
            dispatch({ type: "SEARCH_SUCCEEDED", results: response.data ?? [] });
          }
        })
        .catch((error) => {
          if (!cancelled) dispatch({ type: "SEARCH_FAILED", error: String(error) });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  const setActiveProject = useCallback(async (path: string | null) => {
    dispatch({ type: "ACTIVE_PROJECT_SET", path });
    dispatch({ type: "ACTIVE_THREAD_SET", threadId: null });
    if (!path) return;
    try {
      const response = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: response.data ?? [],
        archived: false,
      });
    } catch (error) {
      // Selecting a Project whose threads fail to load would otherwise show
      // an empty list — the same "silent absence" shape that made a
      // pre-existing conversation render as a blank pane.
      pushNotice(dispatch, {
        severity: "error",
        source: "thread/list",
        message: "无法读取该项目的对话列表",
        details: String(error),
      });
    }
  }, []);

  // Threads picked from the sidebar have no items in this store yet — the
  // store is otherwise purely event-driven, so a thread that predates this app
  // session would render as a blank pane. `thread/resume` both loads the
  // thread server-side (so turns can be sent to it) and returns its full
  // history in `thread.turns`.
  const setActiveThread = useCallback(async (threadId: string | null) => {
    dispatch({ type: "ACTIVE_THREAD_SET", threadId });
    if (!threadId) return;

    const existing = threadsRef.current[threadId];
    if (existing && (existing.historyStatus === "loaded" || existing.historyStatus === "loading")) {
      return;
    }

    dispatch({ type: "HISTORY_LOADING", threadId });
    try {
      const response = await api.resumeThread(threadId);
      dispatch({
        type: "HISTORY_LOADED",
        threadId,
        turns: response.thread?.turns ?? [],
        historyMode: response.thread?.historyMode ?? null,
      });
    } catch (error) {
      // Surfaced in the main pane rather than swallowed — a silently blank
      // pane is exactly the failure this path exists to prevent.
      dispatch({ type: "HISTORY_FAILED", threadId, error: String(error) });
    }
  }, []);

  const addProject = useCallback(async (path: string) => {
    const project = await api.addProject(path);
    dispatch({ type: "PROJECT_ADDED", project });
  }, []);

  const removeProject = useCallback(async (id: string) => {
    try {
      await api.removeProject(id);
      dispatch({ type: "PROJECT_REMOVED", id });
    } catch (error) {
      // Only dispatch on success: a row that vanishes from a failed removal
      // would reappear on the next launch with no explanation.
      pushNotice(dispatch, {
        severity: "error",
        source: "remove_project",
        message: "无法从侧边栏移除该项目",
        details: String(error),
      });
    }
  }, []);

  const startNewThread = useCallback(async (cwd: string) => {
    const selection = modelSelectionRef.current;
    const response = await api.startThread(
      cwd,
      approvalModeRef.current,
      selection.model,
      selection.effort,
    );
    const threadId = response.thread?.id;
    if (!threadId) return;
    dispatch({ type: "ACTIVE_THREAD_SET", threadId });
    // Brand new thread: there is no prior history to fetch, so mark it loaded
    // rather than letting `setActiveThread` resume an empty thread later.
    // `thread/start` reports the mode it actually settled on, which is what
    // the paginated-history negotiation in `src/history_mode.rs` may have had
    // to downgrade.
    dispatch({
      type: "HISTORY_LOADED",
      threadId,
      turns: [],
      historyMode: response.thread?.historyMode ?? null,
    });
    const path = activeProjectPathRef.current;
    if (path) {
      const list = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: list.data ?? [],
        archived: false,
      });
    }
  }, []);

  const sendMessage = useCallback(
    async (
      threadId: string,
      text: string,
      attachments: ComposerAttachment[] = [],
      skills: ComposerSkill[] = [],
      fileRefs: ComposerFileRef[] = [],
      mentions: ComposerMention[] = [],
    ) => {
      await api.sendTurn(threadId, text, attachments, skills, fileRefs, mentions);
    },
    [],
  );

  /**
   * The composer's one submit action. Steering is not a separate intent in
   * the engine's model — with a turn running the engine wants the message
   * folded into it, falling back to the queue only for turn kinds that
   * refuse steering. Rust decides, because the reasons arrive as error
   * strings and error `data`, and returns which path it took.
   *
   * The active turn id is read from the ref at call time rather than closed
   * over, so a turn that ends between paint and click is a `started` rather
   * than a steer aimed at a dead turn.
   */
  const submitMessage = useCallback(
    async (
      threadId: string,
      text: string,
      attachments: ComposerAttachment[] = [],
      skills: ComposerSkill[] = [],
      fileRefs: ComposerFileRef[] = [],
      mentions: ComposerMention[] = [],
    ) => {
      const thread = threadsRef.current[threadId];
      const activeTurnId = thread?.activeTurnId ?? null;
      const running =
        activeTurnId !== null && thread?.turnStatus[activeTurnId] === "inProgress";
      return api.submitTurn(
        threadId,
        running ? activeTurnId : null,
        text,
        attachments,
        skills,
        fileRefs,
        mentions,
      );
    },
    [],
  );

  /**
   * `thread/revert`. Conversation history only — files the agent wrote stay
   * written (see `src/thread_ops.rs`). The engine keeps thread state across
   * its internal reload, but this client's item store still holds the turns
   * that were just dropped, so re-resume to rehydrate what was retained.
   */
  const revertThread = useCallback(async (threadId: string, beforeTurnId: string) => {
    await api.revertThread(threadId, beforeTurnId);
    // Clear before reloading. `HISTORY_LOADED` merges, so without this the
    // turns the engine just dropped would stay on screen; `thread/resume`
    // then returns the retained history in one call.
    dispatch({ type: "HISTORY_CLEARED", threadId });
    try {
      const response = await api.resumeThread(threadId);
      dispatch({
        type: "HISTORY_LOADED",
        threadId,
        turns: response.thread?.turns ?? [],
        historyMode: response.thread?.historyMode ?? null,
      });
    } catch (error) {
      dispatch({ type: "HISTORY_FAILED", threadId, error: String(error) });
    }
  }, []);

  /**
   * `thread/compact/start`. The running flag is cleared by the
   * `thread/compacted` notification, not here — compaction continues
   * server-side after this call returns.
   */
  const compactThread = useCallback(async (threadId: string) => {
    dispatch({ type: "COMPACTION_STARTED", threadId });
    try {
      await api.compactThread(threadId);
    } catch (error) {
      dispatch({ type: "COMPACTION_FINISHED", threadId });
      throw error;
    }
  }, []);

  // --- Queue ---------------------------------------------------------------
  //
  // Dispatch is the engine's job, not this client's. `QueuedItemService`
  // implements `on_thread_idle` and pops the head of the queue whenever a
  // thread goes idle for any cause except an interrupt
  // (`ext/queue/src/service.rs`), and `enqueue` wakes an already-idle thread so
  // it starts right away. Every mutation below therefore just edits the queue
  // and lets `thread/queue/changed` report the result — there is deliberately
  // no "start the next one" call on turn completion, which would race the
  // engine and could run a submission twice.

  const queueMessage = useCallback(
    async (
      threadId: string,
      text: string,
      attachments: ComposerAttachment[] = [],
      skills: ComposerSkill[] = [],
      fileRefs: ComposerFileRef[] = [],
      mentions: ComposerMention[] = [],
    ) => {
      await api.queueAdd(threadId, text, attachments, skills, fileRefs, mentions);
    },
    [],
  );

  const editQueued = useCallback(
    async (threadId: string, queuedSubmissionId: string, text: string) => {
      await api.queueUpdate(threadId, queuedSubmissionId, text);
    },
    [],
  );

  const removeQueued = useCallback(async (threadId: string, queuedSubmissionId: string) => {
    await api.queueDelete(threadId, queuedSubmissionId);
  }, []);

  /**
   * The RPC takes a complete ordering; deriving it from a move is done in
   * Rust so the index arithmetic is under test (`reorder_ids`). The current
   * order is read at call time, like `interruptActiveTurn` — the queue can
   * move between paint and click, since the engine dispatches from it too.
   */
  const moveQueued = useCallback(
    async (threadId: string, queuedSubmissionId: string, delta: number) => {
      const ids = (threadsRef.current[threadId]?.queue ?? []).map((entry) => entry.id);
      await api.queueMove(threadId, ids, queuedSubmissionId, delta);
    },
    [],
  );

  /**
   * Manual dispatch, valid only while the thread is idle. The engine refuses
   * with "thread already has an active or pending turn" otherwise, which is
   * why the UI only offers this when nothing is running.
   */
  const startQueuedNow = useCallback(async (threadId: string, queuedSubmissionId?: string) => {
    await api.queueStart(threadId, queuedSubmissionId ?? null);
  }, []);

  // --- Background terminals ------------------------------------------------

  const refetchBackgroundTerminals = useCallback(async (threadId: string) => {
    const terminals = await api.backgroundTerminalsList(threadId);
    dispatch({ type: "BACKGROUND_TERMINALS_LOADED", threadId, terminals });
  }, []);

  const terminateBackgroundTerminal = useCallback(
    async (threadId: string, processId: string) => {
      await api.backgroundTerminalTerminate(threadId, processId);
      const terminals = await api.backgroundTerminalsList(threadId);
      dispatch({ type: "BACKGROUND_TERMINALS_LOADED", threadId, terminals });
    },
    [],
  );

  const cleanBackgroundTerminals = useCallback(async (threadId: string) => {
    await api.backgroundTerminalsClean(threadId);
    const terminals = await api.backgroundTerminalsList(threadId);
    dispatch({ type: "BACKGROUND_TERMINALS_LOADED", threadId, terminals });
  }, []);

  // --- Goal ----------------------------------------------------------------

  const refetchGoal = useCallback(async (threadId: string) => {
    const response = await api.goalGet(threadId);
    dispatch({ type: "GOAL_LOADED", threadId, goal: response.goal ?? null });
  }, []);

  /**
   * Every field is a patch; omitting one leaves it alone. `tokenBudget` is
   * three-way rather than nullable because the protocol distinguishes "leave
   * alone" from "clear" (see `TokenBudgetEdit`).
   */
  const setGoal = useCallback(
    async (
      threadId: string,
      objective?: string | null,
      status?: ThreadGoalStatus | null,
      tokenBudget?: TokenBudgetEdit | null,
    ) => {
      const response = await api.goalSet(threadId, objective, status, tokenBudget);
      dispatch({ type: "GOAL_LOADED", threadId, goal: response.goal });
    },
    [],
  );

  const clearGoal = useCallback(async (threadId: string) => {
    await api.goalClear(threadId);
    dispatch({ type: "GOAL_LOADED", threadId, goal: null });
  }, []);

  /**
   * `review/start`. A detached review runs on a *different* thread
   * (`reviewThreadId`); switching to it is what keeps that from being a dead
   * end, since ADR-0017 keeps sub-agent-kind threads out of the sidebar's
   * default listing so it may not appear there on its own.
   */
  const startReview = useCallback(
    async (threadId: string, target: ReviewTargetInput, delivery: ReviewDelivery) => {
      const response = await api.startReview(threadId, target, delivery);
      const reviewThreadId = response?.reviewThreadId;
      if (delivery === "detached" && reviewThreadId && reviewThreadId !== threadId) {
        await setActiveThread(reviewThreadId);
      }
    },
    [setActiveThread],
  );

  /**
   * ADR-0018's Fork action. `thread/fork` returns the new thread, which
   * becomes active; its history comes back through the normal resume path.
   */
  const forkThreadFromTurn = useCallback(async (threadId: string, turnId: string) => {
    const response = await api.forkThread(threadId, turnId);
    const forkedId = response.thread?.id;
    if (!forkedId) return;
    dispatch({ type: "ACTIVE_THREAD_SET", threadId: forkedId });
    dispatch({
      type: "HISTORY_LOADED",
      threadId: forkedId,
      turns: response.thread?.turns ?? [],
      historyMode: response.thread?.historyMode ?? null,
    });
    const path = activeProjectPathRef.current;
    if (path) {
      const list = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: list.data ?? [],
        archived: false,
      });
    }
  }, []);

  // --- Thread management (all via `thread/*` RPCs — ADR-0021) ---------------
  //
  // These deliberately do not patch the sidebar optimistically. The server
  // broadcasts `thread/name/updated` / `thread/archived` / `thread/deleted`
  // for every one of them, and letting that notification be the single source
  // of the list update means a change made from the CLI lands identically to
  // one made here.

  const renameThread = useCallback(async (threadId: string, name: string) => {
    await api.setThreadName(threadId, name);
  }, []);

  const archiveThread = useCallback(async (threadId: string) => {
    await api.archiveThread(threadId);
  }, []);

  const unarchiveThread = useCallback(async (threadId: string) => {
    await api.unarchiveThread(threadId);
    // No `thread/unarchived` handler can refresh the *non*-archived list on
    // its own — it only knows the thread id, not which Project list to add it
    // back to — so re-list the active Project here.
    const path = activeProjectPathRef.current;
    if (path) {
      const list = await api.listThreads(path);
      dispatch({
        type: "THREADS_LOADED",
        projectPath: path,
        threads: list.data ?? [],
        archived: false,
      });
    }
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    await api.deleteThread(threadId);
  }, []);

  /**
   * Expanding the archived section lazily fetches it — a second `thread/list`
   * call, since the protocol's `archived` filter can't return both states at
   * once.
   */
  const setArchivedVisible = useCallback(async (projectPath: string, visible: boolean) => {
    dispatch({ type: "ARCHIVED_VISIBILITY_SET", projectPath, visible });
    if (!visible) return;
    try {
      const list = await api.listThreads(projectPath, true);
      dispatch({
        type: "THREADS_LOADED",
        projectPath,
        threads: list.data ?? [],
        archived: true,
      });
    } catch (error) {
      // An expanded-but-empty archived section reads as "nothing archived",
      // which is exactly wrong when the list simply failed to load.
      pushNotice(dispatch, {
        severity: "error",
        source: "thread/list",
        message: "无法读取已归档的对话",
        details: String(error),
      });
    }
  }, []);

  const setSearchTerm = useCallback((term: string) => {
    dispatch({ type: "SEARCH_TERM_SET", term });
  }, []);

  const exitSearch = useCallback(() => {
    dispatch({ type: "SEARCH_EXITED" });
  }, []);

  /**
   * ADR-0016 layer 1, composer side. Applied to the active thread
   * immediately and carried onto later threads by `startNewThread`, but
   * deliberately *not* written to `config.toml`: ADR-0020 makes this an
   * override of the persisted default, not a way to silently rewrite it.
   */
  const setApprovalMode = useCallback(async (mode: ApprovalMode) => {
    dispatch({ type: "APPROVAL_MODE_SET", mode, overrides: true });
    const threadId = activeThreadIdRef.current;
    if (threadId) await api.setApprovalMode(threadId, mode);
  }, []);

  /** Same shape as `setApprovalMode`, and the same override semantics. */
  const setModelSelection = useCallback(async (selection: ModelSelection) => {
    dispatch({ type: "MODEL_SELECTION_SET", selection, overrides: true });
    const threadId = activeThreadIdRef.current;
    if (threadId) await api.setModel(threadId, selection.model, selection.effort);
  }, []);

  /**
   * Applies a collaboration mode to the active thread.
   *
   * The current model/effort go along because the engine's mode is a
   * `{ mode, settings }` bundle, not a flag — Rust builds the effective mode
   * by applying the preset mask over a base carrying these settings, using
   * the engine's own `apply_mask`.
   *
   * The TUI refuses to switch mode mid-turn ("Cannot switch collaboration
   * mode while a turn is running"), so the composer only offers the entry
   * when nothing is running; this dispatches optimistically and rolls back if
   * the engine rejects it anyway.
   */
  const setCollaborationMode = useCallback(async (mode: string) => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    const previous = collaborationModeRef.current;
    dispatch({ type: "COLLABORATION_MODE_SET", mode });
    try {
      const selection = modelSelectionRef.current;
      await api.setCollaborationMode(threadId, mode, selection.model, selection.effort);
    } catch (error) {
      dispatch({ type: "COLLABORATION_MODE_SET", mode: previous });
      throw error;
    }
  }, []);

  /**
   * Applies a personality to the active thread (`/personality`).
   *
   * A per-thread override like the model picker, dispatched optimistically
   * and rolled back on rejection so the indicator cannot claim a style the
   * engine did not accept.
   */
  const setPersonality = useCallback(async (personality: Personality) => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    const previous = personalityRef.current;
    dispatch({ type: "PERSONALITY_SET", personality });
    try {
      await api.setPersonality(threadId, personality);
    } catch (error) {
      if (previous) dispatch({ type: "PERSONALITY_SET", personality: previous });
      throw error;
    }
  }, []);

  /**
   * Settings side of the same setting: persists to `config.toml`, then
   * reloads so the session value follows unless the composer overrode it.
   */
  const setDefaultApprovalMode = useCallback(
    async (mode: ApprovalMode) => {
      await api.setDefaultApprovalMode(mode);
      await reloadConfig();
    },
    [reloadConfig],
  );

  /**
   * Generic single-key writer behind the settings controls. Reloads rather
   * than optimistically patching local state: the server may normalize the
   * value, or refuse it because a managed layer pins the key.
   */
  const writeSetting = useCallback(
    async (edit: SettingEdit) => {
      await api.writeConfigValue(edit);
      await reloadConfig();
    },
    [reloadConfig],
  );

  const openSettings = useCallback((screen = "general") => {
    dispatch({ type: "SETTINGS_SCREEN_SET", screen });
  }, []);

  const closeSettings = useCallback(() => {
    dispatch({ type: "SETTINGS_SCREEN_SET", screen: null });
  }, []);

  /**
   * Stops the thread's running turn. Reads `activeTurnId` at call time rather
   * than from a captured render, so a turn that finished between paint and
   * click is a no-op instead of an interrupt aimed at a stale turn id.
   */
  const interruptActiveTurn = useCallback(async (threadId: string) => {
    const thread = threadsRef.current[threadId];
    const turnId = thread?.activeTurnId;
    if (!turnId || thread?.turnStatus[turnId] !== "inProgress") return;
    await api.interruptTurn(threadId, turnId);
  }, []);

  /**
   * Starts ChatGPT sign-in and opens the returned URL. `account/login/start`
   * only *begins* the flow — completion arrives as
   * `account/login/completed`, which is what clears `pendingLogin`.
   */
  const startLogin = useCallback(async () => {
    const response = await api.startAccountLogin();
    if (response.type === "chatgpt") {
      dispatch({
        type: "LOGIN_STARTED",
        login: { loginId: response.loginId, authUrl: response.authUrl, error: null },
      });
      // Reuses the OS handler already used for `config.toml`; `open`/`start`/
      // `xdg-open` all take URLs as readily as paths.
      await api.openPathInOs(response.authUrl);
      return;
    }
    if (response.type === "chatgptDeviceCode") {
      dispatch({
        type: "LOGIN_STARTED",
        login: {
          loginId: response.loginId,
          authUrl: response.verificationUrl,
          error: `请在浏览器中输入代码：${response.userCode}`,
        },
      });
      await api.openPathInOs(response.verificationUrl);
      return;
    }
    // The remaining arms complete server-side with no URL to visit.
    dispatch({ type: "LOGIN_COMPLETED", error: null });
    refetchAccount();
  }, [refetchAccount]);

  const cancelLogin = useCallback(async () => {
    const loginId = pendingLoginRef.current?.loginId;
    if (!loginId) return;
    await api.cancelAccountLogin(loginId);
    dispatch({ type: "LOGIN_COMPLETED", error: null });
  }, []);

  const logout = useCallback(async () => {
    await api.logoutAccount();
    refetchAccount();
  }, [refetchAccount]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      dispatch,
      setActiveProject,
      setActiveThread,
      addProject,
      removeProject,
      startNewThread,
      sendMessage,
      submitMessage,
      revertThread,
      compactThread,
      startReview,
      refetchSkills,
      refetchFeatures,
      forkThreadFromTurn,
      queueMessage,
      refetchQueue,
      editQueued,
      removeQueued,
      moveQueued,
      startQueuedNow,
      refetchBackgroundTerminals,
      terminateBackgroundTerminal,
      cleanBackgroundTerminals,
      refetchGoal,
      setGoal,
      clearGoal,
      renameThread,
      archiveThread,
      unarchiveThread,
      deleteThread,
      setArchivedVisible,
      setSearchTerm,
      exitSearch,
      setApprovalMode,
      setModelSelection,
      setCollaborationMode,
      setPersonality,
      interruptActiveTurn,
      openSettings,
      closeSettings,
      setDefaultApprovalMode,
      writeSetting,
      reloadConfig,
      startLogin,
      cancelLogin,
      logout,
      refreshAccount: refetchAccount,
    }),
    [
      state,
      setActiveProject,
      setActiveThread,
      addProject,
      removeProject,
      startNewThread,
      sendMessage,
      submitMessage,
      revertThread,
      compactThread,
      startReview,
      refetchSkills,
      refetchFeatures,
      forkThreadFromTurn,
      queueMessage,
      refetchQueue,
      editQueued,
      removeQueued,
      moveQueued,
      startQueuedNow,
      refetchBackgroundTerminals,
      terminateBackgroundTerminal,
      cleanBackgroundTerminals,
      refetchGoal,
      setGoal,
      clearGoal,
      renameThread,
      archiveThread,
      unarchiveThread,
      deleteThread,
      setArchivedVisible,
      setSearchTerm,
      exitSearch,
      setApprovalMode,
      setModelSelection,
      setCollaborationMode,
      setPersonality,
      interruptActiveTurn,
      openSettings,
      closeSettings,
      setDefaultApprovalMode,
      writeSetting,
      reloadConfig,
      startLogin,
      cancelLogin,
      logout,
      refetchAccount,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used within StoreProvider");
  return value;
}
