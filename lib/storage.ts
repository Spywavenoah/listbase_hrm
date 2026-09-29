const PREFIX = 'hrm';

const NAMESPACE = {
  session: `${PREFIX}.employee_session`,
  preferences: `${PREFIX}.preferences`,
} as const;

function scoped(
  key: (typeof NAMESPACE)[keyof typeof NAMESPACE] | string,
  namespace?: string
): string {
  if (!namespace) return key;
  return `${key}.${namespace}`;
}

export const storage = {
  get<T>(key: string, namespace?: string): T | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(scoped(key, namespace));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  getString(key: string, namespace?: string): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(scoped(key, namespace));
  },

  set(key: string, value: unknown, namespace?: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(scoped(key, namespace), JSON.stringify(value));
  },

  setString(key: string, value: string, namespace?: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(scoped(key, namespace), value);
  },

  remove(key: string, namespace?: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(scoped(key, namespace));
  },
} as const;

export interface Preferences {
  darkMode: boolean;
  sidebarOpen: boolean;
  [key: string]: boolean;
}

const PREF_KEYS = {
  darkMode: 'darkMode',
  sidebarOpen: 'sidebarOpen',
} as const;

export function getPreferences(namespace?: string): Preferences {
  const stored = storage.get<Partial<Preferences>>(NAMESPACE.preferences, namespace);
  const systemDark =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    darkMode: stored?.darkMode ?? systemDark,
    sidebarOpen: stored?.sidebarOpen ?? true,
  };
}

export function getPreference(key: keyof Preferences, namespace?: string): boolean {
  return getPreferences(namespace)[key];
}

export function setPreference(
  key: keyof Preferences,
  value: boolean,
  namespace?: string
): void {
  const updated = { ...getPreferences(namespace), [key]: value };
  storage.set(NAMESPACE.preferences, updated, namespace);
}

export { NAMESPACE, PREF_KEYS };