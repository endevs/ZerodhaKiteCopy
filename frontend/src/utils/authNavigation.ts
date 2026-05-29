const NAV_GUARD_KEY = 'zerodha_auth_nav_guard_ms';
const NAV_GUARD_MS = 2500;

/** Prevents rapid welcome ↔ dashboard redirects that freeze the browser. */
export function tryAcquireAuthNavigationLock(): boolean {
  const now = Date.now();
  const last = Number(sessionStorage.getItem(NAV_GUARD_KEY) || '0');
  if (last > 0 && now - last < NAV_GUARD_MS) {
    return false;
  }
  sessionStorage.setItem(NAV_GUARD_KEY, String(now));
  return true;
}

export function clearAuthNavigationLock(): void {
  sessionStorage.removeItem(NAV_GUARD_KEY);
}
