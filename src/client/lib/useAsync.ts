import { useEffect, useState } from "react";

/**
 * Runs `load(key)` whenever `key` changes and returns its value, or undefined while loading.
 * `load` must be a stable (module-level) function.
 */
export function useAsync<T>(key: string, load: (key: string) => Promise<T>): T | undefined {
  const [state, setState] = useState<{ key: string; value: T } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void load(key).then((value) => {
      if (live) setState({ key, value });
    });
    return () => {
      live = false;
    };
  }, [key, load]);
  return state && state.key === key ? state.value : undefined;
}
