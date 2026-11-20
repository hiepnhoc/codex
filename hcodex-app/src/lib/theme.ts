import { useSyncExternalStore } from "react";

export type ColorScheme = "dark" | "light";

const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

function subscribe(onChange: () => void) {
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** The system's light/dark setting; the stylesheet follows it through `prefers-color-scheme`. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, () => (query?.matches ? "light" : "dark"));
}

/** Editor and terminal colours that match the stylesheet's `--bg` in each scheme. */
export const SURFACE: Record<ColorScheme, { background: string; foreground: string; selection: string }> = {
  dark: { background: "#15171a", foreground: "#e6e8eb", selection: "#33405c" },
  light: { background: "#ffffff", foreground: "#1c1f24", selection: "#cfdcf7" },
};

export const monacoTheme = (scheme: ColorScheme) => (scheme === "light" ? "hcodex-light" : "hcodex-dark");
