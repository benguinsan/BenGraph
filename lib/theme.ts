// The choice lives in localStorage, not a cookie, so the server never needs it and
// pages stay prerenderable under Cache Components.
export const THEME_KEY = "theme";

// Runs in <head> while the HTML is parsed, before first paint, so a forced theme
// never flashes. Same rule as storedTheme() in the theme control: anything other
// than "light" or "dark" means follow the system.
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"system"}catch(e){}`;
