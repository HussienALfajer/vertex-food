import { MoonIcon, SunIcon } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme, useThemeToggle } from './theme';

/**
 * Switches between the light and dark themes, as on the web (Vertex Hub's toggle): one icon
 * button, a moon in light and a sun in dark, named by what it switches to. Labels come in as props.
 */
export function ThemeToggle({ labels }: { labels: { toDark: string; toLight: string } }) {
  const { scheme, colors, radius } = useTheme();
  const toggle = useThemeToggle();
  const Icon = scheme === 'dark' ? SunIcon : MoonIcon;
  return (
    <Pressable
      role="button"
      aria-label={scheme === 'dark' ? labels.toLight : labels.toDark}
      onPress={toggle}
      style={[styles.button, { borderRadius: radius.md }]}
    >
      <Icon color={colors.foreground} size={20} aria-hidden />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The smallest touch target on both platforms.
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
