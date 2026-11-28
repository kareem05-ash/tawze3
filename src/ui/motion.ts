/** True when JS-driven motion (delayed unmounts, theme cross-fade) may run. Mirrors the CSS prefers-reduced-motion rule; no matchMedia -> no motion. */
export function canAnimate(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
export const EXIT_MS = 180;
