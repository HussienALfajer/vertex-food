import type { ReactNode } from 'react';
import { type Role, Text, View, type ViewProps } from 'react-native';
import { useTheme } from './theme';

/** A flat surface defined by its border, not a shadow (brand/identity.md §4). */
export function Card({ style, role, ...props }: ViewProps & { role?: Role }) {
  const { colors, space, radius } = useTheme();
  return (
    <View
      {...(role ? { role } : {})}
      style={[
        {
          gap: space[4],
          padding: space[6],
          borderWidth: 1,
          borderRadius: radius.lg,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
        style,
      ]}
      {...props}
    />
  );
}

/** The card's heading: level 1 when the card is the screen's main content. */
export function CardTitle({ children, level = 2 }: { children: ReactNode; level?: number }) {
  const { colors, fontSize, fontWeight } = useTheme();
  return (
    <Text
      role="heading"
      aria-level={level}
      style={{
        color: colors.surfaceForeground,
        fontSize: fontSize.xl.size,
        lineHeight: fontSize.xl.lineHeight,
        fontWeight: fontWeight.bold,
      }}
    >
      {children}
    </Text>
  );
}

export function CardDescription({ children }: { children: ReactNode }) {
  const { colors, fontSize } = useTheme();
  return (
    <Text
      style={{
        color: colors.mutedForeground,
        fontSize: fontSize.base.size,
        lineHeight: fontSize.base.lineHeight,
      }}
    >
      {children}
    </Text>
  );
}
