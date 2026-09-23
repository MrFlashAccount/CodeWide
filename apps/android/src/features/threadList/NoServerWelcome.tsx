import { Pressable, useWindowDimensions, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { useEvent } from "../../react/useEvent";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./NoServerWelcome.styles";

const atmospherePaths = `
  <defs>
    <filter id="wide" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="36"/></filter>
    <filter id="soft" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="15"/></filter>
  </defs>
  <path d="M-90 345 C25 145 365 145 480 345" fill="none" stroke="#557be5" stroke-opacity=".7" stroke-width="84" filter="url(#wide)"/>
  <path d="M-90 345 C25 145 365 145 480 345" fill="none" stroke="#92abff" stroke-opacity=".42" stroke-width="30" filter="url(#soft)"/>
`;
const mobileAtmosphere = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 800">${atmospherePaths}</svg>`;
const wideAtmosphere = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-250 0 890 800">${atmospherePaths}</svg>`;
const WIDE_ATMOSPHERE_MIN_WIDTH = 700;

/** The catalog's starting state stays available whenever every server is removed. */
export function NoServerWelcome({
  onConnect,
}: {
  readonly onConnect: () => void;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.root} testID="no-server-welcome">
      <View accessibilityElementsHidden pointerEvents="none" style={styles.atmosphere}>
        <SvgXml
          height="100%"
          width="100%"
          xml={width >= WIDE_ATMOSPHERE_MIN_WIDTH ? wideAtmosphere : mobileAtmosphere}
        />
      </View>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Welcome to CodeWide
        </Text>
        <Text style={styles.description}>Your Codex workspace on your phone, wherever you go.</Text>
        <ConnectButton onPress={onConnect} />
        <Text style={styles.hint}>Follow the setup steps for your computer's OS.</Text>
      </View>
    </View>
  );
}

function ConnectButton({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  const press = useEvent(onPress);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={press}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      testID="no-server-connect"
    >
      <Text style={styles.buttonLabel}>Connect a server</Text>
    </Pressable>
  );
}
