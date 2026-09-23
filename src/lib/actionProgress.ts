export type ActionProgressState = { label: string; visible: boolean } | null;

export function createActionProgressRunner(
  onStateChange: (state: ActionProgressState) => void,
  delayMs = 180,
) {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    isActive: () => active,
    async run<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
      if (active) return undefined;
      active = true;
      onStateChange({ label, visible: false });
      timer = setTimeout(() => onStateChange({ label, visible: true }), delayMs);
      try {
        return await action();
      } finally {
        if (timer) clearTimeout(timer);
        timer = null;
        active = false;
        onStateChange(null);
      }
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      active = false;
      onStateChange(null);
    },
  };
}
