import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, useColors } from '../lib/theme';

/** The frame of every screen. "Vertex Food" is always visible (ADR 0018). */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common', 'driver']);
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.shell, { backgroundColor: colors.background }]}>
      <View role="banner" style={[styles.header, { backgroundColor: colors.surface }]}>
        <Text style={[styles.product, { color: colors.text }]}>{t('productName')}</Text>
        <Text style={{ color: colors.textMuted }}>{t('driver:productLabel')}</Text>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <ScrollView role="main" contentContainerStyle={styles.main}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space[3],
    paddingBlock: space[3],
    paddingInline: space[6],
  },
  product: { fontSize: 18, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  main: { flexGrow: 1, padding: space[6] },
});
