import { PoweredBy, ThemeToggle, useTheme, VertexFoodMark } from '@vertex-food/ui-native';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * The frame of every screen, in the Vertex Food identity (ADR 0010: the driver app never takes a
 * restaurant's colors). "Powered by Vertex Food" is always visible (ADR 0018).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common', 'driver']);
  const { scheme, colors, space, fontSize, fontWeight } = useTheme();
  return (
    <SafeAreaView style={[styles.shell, { backgroundColor: colors.background }]}>
      {/* The status bar follows the theme drawn, not only the system's setting. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View
        role="banner"
        style={[
          styles.row,
          {
            gap: space[3],
            paddingBlock: space[3],
            paddingInline: space[6],
            backgroundColor: colors.surface,
          },
        ]}
      >
        <VertexFoodMark color={colors.primary} width={28} />
        <Text
          style={[
            {
              color: colors.foreground,
              fontSize: fontSize.lg.size,
              lineHeight: fontSize.lg.lineHeight,
              fontWeight: fontWeight.bold,
            },
          ]}
        >
          {t('productName')}
        </Text>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {t('driver:productLabel')}
        </Text>
        <ThemeToggle labels={{ toDark: t('theme.toDark'), toLight: t('theme.toLight') }} />
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <ScrollView role="main" contentContainerStyle={[styles.main, { padding: space[6] }]}>
        {children}
      </ScrollView>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View role="contentinfo" style={{ paddingBlock: space[2], paddingInline: space[6] }}>
        <PoweredBy label={t('poweredBy')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  // The mark and the product name at the start, the theme button at the end.
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  main: { flexGrow: 1 },
});
