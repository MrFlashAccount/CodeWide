import { StyleSheet, View } from "react-native";
import { colors } from "../../theme";

const PROGRESS_PERCENT = 100;
const TRACK_HEIGHT = 2;

/** Native loading progress occupies a stable two-pixel track below navigation. */
export function BrowserLoadingBar(props: {
  readonly loading: boolean;
  readonly progress: number;
}): React.JSX.Element {
  return (
    <View style={styles.track}>
      {props.loading && (
        <>
          <View
            accessibilityLabel="Page loading"
            accessibilityRole="progressbar"
            accessibilityValue={{
              max: PROGRESS_PERCENT,
              min: 0,
              now: Math.round(props.progress * PROGRESS_PERCENT),
            }}
            accessible
            style={[styles.fill, { flex: props.progress }]}
          />
          <View style={{ flex: 1 - props.progress }} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    backgroundColor: colors.accent,
    height: TRACK_HEIGHT,
  },
  track: {
    backgroundColor: colors.surface,
    flexDirection: "row",
    height: TRACK_HEIGHT,
  },
});
