"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "reckt-iq-theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const savedTheme = document.documentElement.dataset.theme;
    const currentTheme = savedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = currentTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = currentTheme === "light" ? "#e6ebe6" : "#000000";
    setTheme(currentTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = nextTheme === "light" ? "#e6ebe6" : "#000000";
    localStorage.setItem(STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "light"}
      title={`Switch to ${nextTheme} mode`}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === "dark" ? "☼" : "☾"}</span>
    </button>
  );
}
