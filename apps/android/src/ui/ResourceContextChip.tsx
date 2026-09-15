/** V1 ResourceContextChip owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { AnimatedNumber, integerNumberFormat } from "./AnimatedNumber";
import { formatNumber } from "./number-format";
import { styles } from "./ResourceContextChip.styles";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

export function ComposerContextLabel({
  text,
  loading = false,
  testID,
}: {
  text: string;
  loading?: boolean;
  testID?: string;
}) {
  return loading ? (
    <WaveText
      {...(testID === undefined ? {} : { testID })}
      text={text}
      style={styles.composerContextText}
      containerStyle={styles.composerContextWave}
    />
  ) : (
    <Text testID={testID} numberOfLines={1} style={styles.composerContextText}>
      {text}
    </Text>
  );
}

export function ComposerContextCount({
  label,
  value,
  refreshing = false,
  testID,
}: {
  label: string;
  value: number;
  refreshing?: boolean;
  testID?: string;
}) {
  return (
    <View testID={testID} style={styles.composerContextCount}>
      <AnimatedNumber
        value={value}
        format={integerNumberFormat}
        prefix={`${label} · `}
        style={styles.composerContextText}
        containerStyle={[
          styles.composerContextValue,
          refreshing && styles.composerContextCountHidden,
        ]}
      />
      {refreshing && (
        <WaveText
          text={`${label} · ${formatNumber(value, integerNumberFormat)}`}
          style={styles.composerContextText}
          containerStyle={styles.composerContextRefreshOverlay}
        />
      )}
    </View>
  );
}
