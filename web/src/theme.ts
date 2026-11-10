export type Theme = "light" | "dark";

const STORAGE_KEY = "cursor-chat-theme";

export function getStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // ignore
  }
  return null;
}

export function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(stored = getStoredTheme()): Theme {
  return stored ?? getPreferredTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f3eee7" : "#0c0b0a");
  const status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  // Keep the iOS status bar opaque so chrome never draws under a blurred system bar
  if (status) status.setAttribute("content", theme === "light" ? "default" : "black");
}

export function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  applyTheme(theme);
}
