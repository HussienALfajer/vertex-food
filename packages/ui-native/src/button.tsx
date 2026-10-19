import { space } from '@vertex-food/tokens';
import { Pressable, type PressableProps, StyleSheet, Text } from 'react-native';
import { useTheme } from './theme';

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  /** The visible label, already translated. */
  label: string;
  variant?: 'primary' | 'secondary';
};

/**
 * A button with the web design system's shape: 6 px radius, never a pill (brand/identity.md §4).
 * Inside an Expo Router `<Link asChild>` it navigates and keeps the link's role.
 */
export function Button({ label, variant = 'primary', role = 'button', ...props }: ButtonProps) {
  const { colors, radius, fontSize, fontWeight } = useTheme();
  const [background, foreground] =
    variant === 'primary'
      ? [colors.primary, colors.primaryForeground]
      : [colors.secondary, colors.secondaryForeground];
  // The style comes after the spread: `<Link asChild>` passes its own `style` through the props.
  return (
    <Pressable
      role={role}
      {...props}
      style={[styles.button, { borderRadius: radius.md, backgroundColor: background }]}
    >
      <Text
        style={{
          color: foreground,
          fontSize: fontSize.base.size,
          lineHeight: fontSize.base.lineHeight,
          fontWeight: fontWeight.medium,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // the smallest touch target on both platforms
    paddingInline: space[4],
  },
});
