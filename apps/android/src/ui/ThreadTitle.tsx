/** V1 ThreadTitle owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { InlineEmoji } from "./InlineIcon";
import { styles } from "./ThreadTitle.styles";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

export function leadingEmoji(value: string): string | null {
  const match =
    /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)/u.exec(
      value,
    );
  return match?.[1] ?? null;
}

export function emojiSafeTitle(value: string): React.ReactNode {
  const emoji = leadingEmoji(value);
  if (emoji === null) {
    return value;
  }
  const title = value.slice(emoji.length).trimStart();
  return (
    <>
      <Text style={styles.emojiText}>{emoji}</Text>
      {title === "" ? null : ` ${title}`}
    </>
  );
}

export function ThreadTitle({ running, value }: { running: boolean; value: string }) {
  const emoji = leadingEmoji(value);
  const title = emoji === null ? value : value.slice(emoji.length).trimStart();
  return (
    <View style={styles.runningThreadTitle}>
      {emoji !== null && title !== "" && <InlineEmoji role="body" value={emoji} />}
      {running ? (
        <WaveText
          containerStyle={styles.threadTitleWave}
          style={styles.threadTitle}
          testID="running-thread-title-shimmer"
          text={title === "" ? value : title}
        />
      ) : (
        <Text numberOfLines={1} style={styles.threadTitle}>
          {title === "" ? value : title}
        </Text>
      )}
    </View>
  );
}

export function RunningThreadTitle({ value }: { value: string }) {
  return <ThreadTitle running value={value} />;
}
