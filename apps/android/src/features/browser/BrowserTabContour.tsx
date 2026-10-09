import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing } from "../../theme";

/** Browser strip silhouette joins the navigation surface; it never participates in hit testing. */
export function BrowserTabContour(props: {
  readonly pressed: boolean;
  readonly selected: boolean;
}): React.JSX.Element {
  const size$ = useConstant(() => observable({ height: 0, width: 0 }));
  const size = useSelector(size$);
  const measure = useEvent((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    const previous = size$.peek();
    if (height !== previous.height || width !== previous.width) {
      size$.set({ height, width });
    }
  });
  const edge = spacing.xs;
  const radius = radii.small;
  const { height, width } = size;
  const right = width - edge;
  const path = `M 0 ${String(height)} Q ${String(edge)} ${String(height)} ${String(edge)} ${String(height - edge)}
    V ${String(radius)} Q ${String(edge)} 0 ${String(edge + radius)} 0
    H ${String(right - radius)} Q ${String(right)} 0 ${String(right)} ${String(radius)}
    V ${String(height - edge)} Q ${String(right)} ${String(height)} ${String(width)} ${String(height)}`;
  return (
    <View onLayout={measure} pointerEvents="none" style={styles.root}>
      {width > 0 && height > 0 && (
        <Svg height={height} width={width}>
          <Path d={`${path} Z`} fill={contourFill(props)} />
          <Path
            d={path}
            fill="none"
            stroke={colors.border}
            strokeWidth={StyleSheet.hairlineWidth}
          />
        </Svg>
      )}
    </View>
  );
}

function contourFill(props: { readonly pressed: boolean; readonly selected: boolean }): string {
  return props.pressed ? colors.surfaceHover : props.selected ? colors.surface : colors.background;
}

const styles = StyleSheet.create({
  root: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
