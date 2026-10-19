import { Card, CardDescription, CardTitle } from '@vertex-food/ui-native';
import type { ReactNode } from 'react';
import { type Role, StyleSheet } from 'react-native';

/** The card of a screen state (home, not found, error), like the web apps' state cards. */
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
  return (
    <Card {...(role ? { role } : {})} style={styles.card}>
      <CardTitle level={1}>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'center', width: '100%', maxWidth: 640 },
});
