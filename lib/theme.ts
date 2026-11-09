// Theme storage is client-only; a session fallback survives reloads when localStorage writes fail.
export const THEME_KEY = "theme";

// Runs in <head> while the HTML is parsed, before first paint, so a forced theme
// never flashes. A valid session fallback wins over a stale persistent value,
// including an explicit "system" choice, just as in storedTheme().
export const themeScript = `(function(){var t;try{t=sessionStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="light"&&t!=="dark"&&t!=="system"){try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"system"})()`;
