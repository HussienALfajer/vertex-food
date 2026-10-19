import type { ReactNode } from 'react';
import { type Role, StyleSheet, Text, View } from 'react-native';
import { radius, space, useColors } from '../lib/theme';

/** The card of a screen state (home, not found, error); copies `.state` of apps/console. */
export function StateCard({
  title,
  description,
  role,
  children,
}: {
  title: string;
  description: string;
  role?: Role;
  children?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      {...(role ? { role } : {})}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text role="heading" aria-level={1} style={[styles.title, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[styles.description, { color: colors.textMuted }]}>{description}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
    marginBlockStart: space[6],
    padding: space[6],
    borderWidth: 1,
    borderRadius: radius,
  },
  title: { marginBlockEnd: space[2], fontSize: 24, fontWeight: '700' },
  description: { marginBlockEnd: space[4], fontSize: 16, lineHeight: 26 },
});

/** The accent button of a state card. */
export const stateButton = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingBlock: space[2],
    paddingInline: space[4],
    borderRadius: radius,
  },
}).button;
