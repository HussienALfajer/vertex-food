import { StyleSheet, Text, View } from 'react-native';
import { VertexFoodMark } from './logo';
import { useTheme } from './theme';

/**
 * "Powered by Vertex Food" with the mark, as on the web (`packages/ui` `PoweredBy`, ADR 0018):
 * always visible on every app shell and on the restaurant's page inside the customer app. A
 * restaurant's identity never removes or restyles it. The label comes in translated.
 */
export function PoweredBy({ label }: { label: string }) {
  const { colors, space, fontSize } = useTheme();
  return (
    <View style={[styles.row, { gap: space[2] }]}>
      <VertexFoodMark color={colors.primary} />
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: fontSize.sm.size,
          lineHeight: fontSize.sm.lineHeight,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
