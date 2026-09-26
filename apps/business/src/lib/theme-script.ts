export const THEME_STORAGE_KEY = "polaris-business-theme";

/**
 * Runs in <head> before first paint, so a saved light or dark choice never
 * flashes the other theme. "system" leaves `data-theme` unset and the CSS
 * follows prefers-color-scheme.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
