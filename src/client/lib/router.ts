import { useSyncExternalStore } from "react";

const NAV_EVENT = "app:navigate";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAV_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAV_EVENT, onChange);
  };
}

function normalise(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => normalise(window.location.pathname));
}

export function navigate(path: string): void {
  if (normalise(window.location.pathname) === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}
