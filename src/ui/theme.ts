import { button } from './dom';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'dispense_theme';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : '';
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private/blocked storage - theme just won't persist across reloads */
  }
}

/** Apply the persisted theme immediately, before any panel renders (no flash). */
export function initTheme(): void {
  applyTheme(getTheme());
}

export function createThemeToggle(): HTMLElement {
  const label = (t: Theme) => (t === 'light' ? 'LIGHT' : 'DARK');
  const btn = button(`THEME: ${label(getTheme())}`, 'theme-toggle');
  btn.setAttribute('aria-label', 'Toggle light/dark theme');
  btn.onclick = () => {
    const next: Theme = getTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    btn.textContent = `THEME: ${label(next)}`;
  };
  return btn;
}
