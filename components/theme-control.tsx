"use client";

import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { THEME_KEY } from "@/lib/theme";

type Theme = "system" | "light" | "dark";

function storedTheme(): Theme {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function chooseTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

// The attribute on <html> is the source of truth. The head script sets it before
// paint and clicks change it, so the control just watches it.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const currentTheme = () => document.documentElement.dataset.theme;
const noThemeOnServer = () => undefined;

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    {path}
  </svg>
);

const options: { value: Theme; label: string; icon: ReactNode }[] = [
  {
    value: "system",
    label: "Match system",
    icon: icon(<path d="M2 3.5h12v8H2zM5.5 14h5M8 11.5V14" />),
  },
  {
    value: "light",
    label: "Light",
    icon: icon(
      <>
        <circle cx="8" cy="8" r="2.75" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
      </>,
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: icon(<path d="M13.5 9.6A5.5 5.5 0 1 1 6.4 2.5a4.5 4.5 0 0 0 7.1 7.1z" />),
  },
];

export function ThemeControl() {
  const current = useSyncExternalStore(subscribe, currentTheme, noThemeOnServer);

  // In development, Strict Mode remounts <html> with only its JSX attributes,
  // dropping what the head script set. Put the stored choice back before paint.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = storedTheme();
  }, []);

  return (
    <div role="group" aria-label="Theme" className="flex h-6 items-center rounded border border-line p-px">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          // The selected look comes from CSS keyed off <html data-theme>, so it is
          // right on first paint. aria-pressed catches up once React hydrates.
          data-theme-option={option.value}
          aria-pressed={current === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => chooseTheme(option.value)}
          className="grid size-5 place-items-center rounded-[3px] text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
