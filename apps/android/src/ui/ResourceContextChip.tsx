/** V1 ResourceContextChip owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { AnimatedNumber, integerNumberFormat } from "./AnimatedNumber";
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

export function ComposerContextCount({
  label,
  refreshing = false,
  testID,
  value,
}: {
  label: string;
  refreshing?: boolean;
  testID?: string;
  value: number;
}) {
  return (
    <View style={styles.composerContextCount} testID={testID}>
      <AnimatedNumber
        containerStyle={[
          styles.composerContextValue,
          refreshing && styles.composerContextCountHidden,
        ]}
        format={integerNumberFormat}
        prefix={`${label} · `}
        style={styles.composerContextText}
        value={value}
      />
      {refreshing && (
        <WaveText
          containerStyle={styles.composerContextRefreshOverlay}
          style={styles.composerContextText}
          text={`${label} · ${formatNumber(value, integerNumberFormat)}`}
        />
      )}
    </View>
  );
}
