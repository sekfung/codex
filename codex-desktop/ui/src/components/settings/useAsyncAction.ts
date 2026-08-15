import { useCallback, useState } from "react";

/**
 * The busy/error scaffold every settings screen needs around a write.
 *
 * Extracted because all of them repeated the same
 * `setBusy(true) / setError(null) / try / catch / finally` shape, and getting
 * the `finally` wrong leaves a screen stuck disabled after a failure.
 *
 * It deliberately does *not* render the error. Several screens put the failure
 * next to the control that produced it rather than in the shared notice bar,
 * because the notice bar is for things the server told us, not for "this button
 * you just pressed didn't work" — so placement stays each screen's decision.
 *
 * `onError` runs before the message is stored, for writes that must undo an
 * optimistic update.
 */
/** Stands in for the key on screens that only ever run one action at a time. */
const WHOLE_SCREEN = "__busy__";

export function useAsyncAction() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      action: () => Promise<unknown>,
      options?: { key?: string; onError?: (err: unknown) => void },
    ) => {
      setBusyKey(options?.key ?? WHOLE_SCREEN);
      setError(null);
      try {
        await action();
      } catch (err) {
        options?.onError?.(err);
        setError(String(err));
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  return {
    /** True while any action is running — for screens with a single control. */
    busy: busyKey !== null,
    /**
     * Which row is running, for the list screens. They key by server name,
     * skill path or plugin id so a write spins only the row it belongs to
     * rather than disabling the whole list.
     */
    busyKey,
    isBusy: useCallback((key: string) => busyKey === key, [busyKey]),
    error,
    setError,
    run,
  };
}
