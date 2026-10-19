import {
  darkColors,
  fontSize,
  fontWeight,
  lightColors,
  radius,
  type SemanticColors,
  space,
} from '@vertex-food/tokens';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform, useColorScheme } from 'react-native';
import {
  parseSavedTheme,
  resolveScheme,
  type ThemeName,
  themeStorageKey,
} from './theme-preference';

export interface Theme {
  scheme: ThemeName;
  colors: SemanticColors;
  space: typeof space;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
}

/** Where the device keeps its choice (`@react-native-async-storage/async-storage` in the app). */
export interface ThemeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const scale = { space, radius, fontSize, fontWeight };
const light: Theme = { scheme: 'light', colors: lightColors, ...scale };
const dark: Theme = { scheme: 'dark', colors: darkColors, ...scale };

const ThemeContext = createContext<Theme>(light);
const ToggleContext = createContext<() => void>(() => {});

/**
 * Gives every screen the Vertex tokens of the light or dark scheme (brand/identity.md §2): the
 * system's setting until the user presses the theme button, then the choice, kept in `storage`.
 * On native the stored choice is read before the first frame, so a screen never shows the other
 * theme first. The web export is rendered ahead in light, and hydration keeps those styles, so on
 * web the scheme applies after mounting.
 */
export function ThemeProvider({
  children,
  storage,
}: {
  children: ReactNode;
  storage?: ThemeStorage;
}) {
  const system = useColorScheme();
  const [mounted, setMounted] = useState(Platform.OS !== 'web');
  // `undefined` until storage is read; `null` when the device made no choice.
  const [saved, setSaved] = useState<ThemeName | null | undefined>(storage ? undefined : null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!storage) return;
    let current = true;
    storage.getItem(themeStorageKey).then(
      (value) => current && setSaved((chosen) => chosen ?? parseSavedTheme(value)),
      () => current && setSaved((chosen) => chosen ?? null),
    );
    return () => {
      current = false;
    };
  }, [storage]);

  const scheme = resolveScheme(saved ?? null, system);
  const toggle = useCallback(() => {
    const next = scheme === 'dark' ? 'light' : 'dark';
    setSaved(next);
    // A choice that cannot be stored still holds until the app restarts.
    storage?.setItem(themeStorageKey, next).catch(() => {});
  }, [scheme, storage]);
  const drawn = useMemo(() => (mounted && scheme === 'dark' ? dark : light), [mounted, scheme]);

  if (saved === undefined && Platform.OS !== 'web') return null;
  return (
    <ToggleContext.Provider value={toggle}>
      <ThemeContext.Provider value={drawn}>{children}</ThemeContext.Provider>
    </ToggleContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Switches between light and dark and keeps the choice: the theme button. */
export function useThemeToggle(): () => void {
  return useContext(ToggleContext);
}
