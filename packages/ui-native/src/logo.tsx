import { markShape } from '@vertex-food/tokens';
import Svg, { Path } from 'react-native-svg';

/**
 * The Vertex Food mark (`brand/logo/svg/vertex-food-mark.svg`, path data from `packages/tokens`)
 * in one color, at least 24 px wide (brand/identity.md §7). Decorative: a visible name sits next
 * to it.
 */
export function VertexFoodMark({ color, width = 24 }: { color: string; width?: number }) {
  const [, , viewWidth = 1, viewHeight = 1] = markShape.viewBox.split(' ').map(Number);
  return (
    <Svg
      viewBox={markShape.viewBox}
      width={width}
      height={(width * viewHeight) / viewWidth}
      aria-hidden
    >
      <Path fill={color} fillRule="evenodd" d={markShape.d} />
    </Svg>
  );
}
