import { useRef, useState } from "react";
import { View } from "react-native";

import { globalVoiceOrbStyles, type GlobalVoiceOrbStyle } from "../../data/globalVoiceOrbStyle";
import { useEvent } from "../../react/useEvent";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

const ORB_STYLE_PRESENTATION: Record<
  GlobalVoiceOrbStyle,
  { readonly description: string; readonly label: string; readonly preview: string }
> = {
  nebula: {
    description: "Soft fluid shader",
    label: "Nebula",
    preview: "◉",
  },
  particles: {
    description: "Responsive particle sphere",
    label: "Particles",
    preview: "·••·",
  },
};

function OrbStyleRow({
  index,
  onSelect,
  selected,
  style,
}: {
  readonly index: number;
  readonly onSelect: (style: GlobalVoiceOrbStyle) => Promise<void>;
  readonly selected: boolean;
  readonly style: GlobalVoiceOrbStyle;
}): React.JSX.Element {
  const presentation = ORB_STYLE_PRESENTATION[style];
  const select = useEvent(() => {
    onSelect(style).catch(() => undefined);
  });
  return (
    <AppListRow
      accessibilityHint="Changes the floating Voice Assistant visual style"
      accessibilityLabel={`Use ${presentation.label} Voice Assistant orb`}
      description={presentation.description}
      fixedHeight={listRowHeight.double}
      onPress={select}
      position={listRowPosition(index, globalVoiceOrbStyles.length)}
      selected={selected}
      title={`${presentation.preview}  ${presentation.label}`}
    />
  );
}

/** Two deterministic previews with immediate, duplicate-safe renderer switching. */
export function OrbStyleSettings({
  onSelect,
  selectedStyle,
}: {
  readonly onSelect: (style: GlobalVoiceOrbStyle) => Promise<void>;
  readonly selectedStyle: GlobalVoiceOrbStyle;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const selectionInFlight = useRef(false);
  const select = useEvent(async (style: GlobalVoiceOrbStyle) => {
    if (selectionInFlight.current || style === selectedStyle) {
      return;
    }
    selectionInFlight.current = true;
    setError(null);
    try {
      await onSelect(style);
    } catch {
      setError("Could not save the orb style.");
    }
    selectionInFlight.current = false;
  });

  return (
    <View style={styles.orbStyleSettings}>
      <Text style={styles.helpText}>
        Choose the visual renderer for the floating Voice Assistant overlay.
      </Text>
      <View accessibilityRole="radiogroup">
        {globalVoiceOrbStyles.map((style, index) => (
          <OrbStyleRow
            index={index}
            key={style}
            onSelect={select}
            selected={style === selectedStyle}
            style={style}
          />
        ))}
      </View>
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}
