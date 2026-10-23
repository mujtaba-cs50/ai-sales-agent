/**
 * Browser side of the authentication system.
 *  - The short-lived JWT access token lives only in memory (never in localStorage, so XSS cannot steal a long-lived secret).
 *  - The long-lived refresh token is an httpOnly cookie that JavaScript cannot read; the server rotates it on every use.
 */
export interface UserSession {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface AuthResult {
  success: boolean;
  user?: UserSession;
  error?: string;
}

let accessToken: string | null = null;
let currentUser: UserSession | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inflightRefresh: Promise<boolean> | null = null;

const changeListeners = new Set<(u: UserSession | null) => void>();
const expiredListeners = new Set<() => void>();

const emitChange = () => changeListeners.forEach((cb) => cb(currentUser));

/** Remove data that older versions of this app stored insecurely (plain-text passwords, fake sessions). */
function clearLegacyStorage() {
  try {
    ['solar_crm_registered_users', 'solar_crm_active_session', 'solar_crm_leads_data'].forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

function setSession(user: UserSession | null, token: string | null, expiresInSec = 0) {
  accessToken = token;
  currentUser = user;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (user && token && expiresInSec > 60) {
    // renew one minute before the access token expires
    refreshTimer = setTimeout(() => void refreshSession(), (expiresInSec - 60) * 1000);
  }
  emitChange();
}

async function post(path: string, body: unknown = {}): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const res = await post('/api/auth/refresh');
      if (res.ok) {
        const d = await readJson(res);
        setSession(d.user, d.accessToken, d.expiresIn);
        return true;
      }
      if (res.status === 401 && currentUser) {
        setSession(null, null);
        expiredListeners.forEach((cb) => cb());
      }
      return false;
    } catch {
      return false; // offline / server down: keep the current state and try again later
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

/** Call once on app start: restores the login from the refresh cookie (if any). */
export async function restoreSession(): Promise<UserSession | null> {
  clearLegacyStorage();
  await refreshSession();
  return currentUser;
}

export const getUser = (): UserSession | null => currentUser;

export function onAuthChange(cb: (u: UserSession | null) => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function onSessionExpired(cb: () => void): () => void {
  expiredListeners.add(cb);
  return () => expiredListeners.delete(cb);
}

async function authRequest(path: string, body: unknown, fallbackError: string): Promise<AuthResult> {
  try {
    const res = await post(path, body);
    const d = await readJson(res);
    if (res.ok && d.accessToken && d.user) {
      setSession(d.user, d.accessToken, d.expiresIn);
      return { success: true, user: d.user };
    }
    if (res.status === 429) return { success: false, error: d.error || 'Too many attempts. Please wait a few minutes and try again.' };
    return { success: false, error: d.error || fallbackError };
  } catch {
    return { success: false, error: 'Cannot reach the server. Please check your connection and try again.' };
  }
}

export function login(email: string, password: string): Promise<AuthResult> {
  if (!email.trim() || !password) return Promise.resolve({ success: false, error: 'Please enter both email and password.' });
  return authRequest('/api/auth/login', { email, password }, 'Login failed. Please try again.');
}

export function register(name: string, email: string, password: string): Promise<AuthResult> {
  return authRequest('/api/auth/signup', { name, email, password }, 'Could not create the account. Please try again.');
}

export async function logout(): Promise<void> {
  setSession(null, null);
  try {
    await post('/api/auth/logout');
  } catch {
    /* the cookie expires on its own; local state is already cleared */
  }
}

/** fetch() with the Authorization header; transparently renews the access token once on 401. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const run = () =>
    fetch(input, {
      ...init,
      credentials: 'same-origin',
      headers: { ...(init.headers || {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
  let res = await run();
  if (res.status === 401 && currentUser) {
    if (await refreshSession()) res = await run();
  }
  return res;
}
