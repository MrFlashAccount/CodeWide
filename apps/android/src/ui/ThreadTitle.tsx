/** V1 ThreadTitle owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { InlineEmoji } from "./InlineIcon";
import { styles } from "./ThreadTitle.styles";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

export function leadingEmoji(value: string): string | null {
  const match = value.match(
    /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)/u,
  );
  return match?.[1] ?? null;
}

export function emojiSafeTitle(value: string): React.ReactNode {
  const emoji = leadingEmoji(value);
  if (emoji === null) return value;
  const title = value.slice(emoji.length).trimStart();
  return (
    <>
      <Text style={styles.emojiText}>{emoji}</Text>
      {title === "" ? null : ` ${title}`}
    </>
  );
}

export function ThreadTitle({ value, running }: { value: string; running: boolean }) {
  const emoji = leadingEmoji(value);
  const title = emoji === null ? value : value.slice(emoji.length).trimStart();
  return (
    <View style={styles.runningThreadTitle}>
      {emoji !== null && title !== "" && <InlineEmoji value={emoji} role="body" />}
      {running ? (
        <WaveText
          testID="running-thread-title-shimmer"
          text={title === "" ? value : title}
          style={styles.threadTitle}
          containerStyle={styles.threadTitleWave}
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
  return <ThreadTitle value={value} running />;
}
