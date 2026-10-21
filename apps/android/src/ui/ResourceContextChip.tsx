/** V1 ResourceContextChip owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { integerNumberFormat } from "./AnimatedNumber";
import { formatNumber } from "./number-format";
import { styles } from "./ResourceContextChip.styles";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

export function ComposerContextLabel({
  loading = false,
  testID,
  text,
}: {
  loading?: boolean;
  testID?: string;
  text: string;
}) {
  return loading ? (
    <WaveText
      {...(testID === undefined ? {} : { testID })}
      containerStyle={styles.composerContextWave}
      style={styles.composerContextText}
      text={text}
    />
  ) : (
    <Text numberOfLines={1} style={styles.composerContextText} testID={testID}>
      {text}
    </Text>
  );
}

/**
 * A context chip's name and live count. Only the name truncates, in the middle, so both
 * ends of a long name (a branch) and the whole count stay readable. While a refresh is
 * pending the same text shimmers in place.
 */
export function ComposerContextCount({
  label,
  loading = false,
  testID,
  value,
}: {
  label: string;
  loading?: boolean;
  testID?: string;
  value: number;
}) {
  return (
    <View
      accessibilityLabel={`${label} · ${formatNumber(value, integerNumberFormat)}`}
      accessibilityRole="text"
      accessibilityState={{ busy: loading }}
      accessible
      style={styles.composerContextCount}
      testID={testID}
    >
      <Text
        ellipsizeMode="middle"
        numberOfLines={1}
        shimmering={loading}
        style={[styles.composerContextText, styles.composerContextCountLabel]}
      >
        {label}
      </Text>
      <Text numberOfLines={1} shimmering={loading} style={styles.composerContextText}>
        {` · ${formatNumber(value, integerNumberFormat)}`}
      </Text>
    </View>
  );
}
