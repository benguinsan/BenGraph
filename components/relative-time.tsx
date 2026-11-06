"use client";

import { useSyncExternalStore } from "react";

const utc = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
// Shown before hydration: short enough to fit the column, so it doesn't resize.
const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// Short units so every time in the column is roughly the same width.
const units: [string, number][] = [
  ["y", 31_536_000_000],
  ["mo", 2_592_000_000],
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
];

// The clock is a store outside React. It is read when a time mounts and never
// again, so nothing ticks: the text says how long ago as of when it appeared.
let now: number | undefined;
function subscribe(onChange: () => void) {
  now = Date.now();
  onChange();
  return () => {};
}
const getNow = () => now;
// The server has no "now" the client would agree with, so it renders the exact
// time and the client swaps in the relative one after hydration.
const noNowOnServer = () => undefined;

export function RelativeTime({ iso }: { iso: string }) {
  const current = useSyncExternalStore(subscribe, getNow, noNowOnServer);
  const exact = `${utc.format(Date.parse(iso))} UTC`;
  return (
    <time dateTime={iso} title={exact}>
      {current === undefined ? short.format(Date.parse(iso)) : ago(current - Date.parse(iso))}
    </time>
  );
}

function ago(elapsed: number) {
  for (const [unit, ms] of units) {
    if (elapsed >= ms) return `${Math.floor(elapsed / ms)}${unit} ago`;
  }
  return "just now";
}
