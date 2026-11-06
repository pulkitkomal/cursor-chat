import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  persistTheme,
  resolveTheme,
  type Theme,
} from "../theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    function onChange() {
      if (getStoredTheme()) return;
      setThemeState(resolveTheme(null));
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return { theme, setTheme, toggleTheme };
}
