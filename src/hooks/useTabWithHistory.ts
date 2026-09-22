"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";

interface TabHistoryOptions {
  /** Other param names to remove from the URL when this param changes */
  clearParams?: string[];
  /** If provided, only these values are accepted from the URL; others fall back to default */
  validValues?: string[];
}

/**
 * Syncs a tab/view state with a URL search parameter so that browser
 * back/forward navigates between previously-visited tabs.
 *
 * @param paramName  - query-string key (e.g. "section", "tab", "step")
 * @param defaultValue - value used when the param is absent from the URL
 * @param options - optional config (e.g. clearParams, validValues)
 * @returns [currentValue, setValue] — drop-in replacement for useState
 */
export function useTabWithHistory<T extends string>(
  paramName: string,
  defaultValue: T,
  options?: TabHistoryOptions
): [T, (value: T) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get(paramName);
  const isValid = raw && (!options?.validValues || options.validValues.includes(raw));
  const current = (isValid ? raw : defaultValue) as T;

  const setValue = useCallback(
    (value: T) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === defaultValue) {
        params.delete(paramName);
      } else {
        params.set(paramName, value);
      }
      if (options?.clearParams) {
        for (const key of options.clearParams) {
          params.delete(key);
        }
      }
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams.toString(), router, pathname, paramName, defaultValue, options?.clearParams?.join(",")]
  );

  return [current, setValue];
}
