"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { createActionProgressRunner, type ActionProgressState } from "@/lib/actionProgress";
type ActionProgressContextValue = {
  runAction: <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
  isProcessing: boolean;
};

const ActionProgressContext = createContext<ActionProgressContextValue | null>(null);

export function useActionProgress(): ActionProgressContextValue {
  const context = useContext(ActionProgressContext);
  if (!context) throw new Error("useActionProgress must be used inside ActionProgressProvider");
  return context;
}

export function ActionProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ActionProgressState | null>(null);
  const runnerRef = useRef<ReturnType<typeof createActionProgressRunner> | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const runAction = useCallback(async <T,>(label: string, action: () => Promise<T>) => {
    const runner = runnerRef.current;
    if (!runner) return undefined;
    if (runner.isActive()) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      return await runner.run(label, action);
    } finally {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    }
  }, []);

  useEffect(() => {
    if (state?.visible) overlayRef.current?.focus();
  }, [state?.visible]);

  useEffect(() => () => runnerRef.current?.dispose(), []);

  if (!runnerRef.current) runnerRef.current = createActionProgressRunner(setState);

  return (
    <ActionProgressContext.Provider value={{ runAction, isProcessing: Boolean(state) }}>
      {children}
      {state?.visible && (
        <div
          ref={overlayRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-busy="true"
          aria-label={state.label}
          onKeyDown={(event) => event.preventDefault()}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/10 px-4 backdrop-blur-[1px] outline-none dark:bg-black/25"
        >
          <div className="flex min-w-[11rem] items-center justify-center gap-2 rounded-full border border-brand-mist/20 bg-white/95 px-4 py-2.5 text-sm font-medium text-brand-green-dark shadow-lg dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100">
            <Loader2Icon className="h-4 w-4 animate-spin text-brand-green dark:text-green-400" aria-hidden="true" />
            <span>{state.label}</span>
          </div>
        </div>
      )}
    </ActionProgressContext.Provider>
  );
}
