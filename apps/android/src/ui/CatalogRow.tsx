import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { InlineEmoji } from "./InlineIcon";
import { leadingEmoji } from "./ThreadTitle";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

const UNREAD_DOT_SIZE = 7;
/** The marker slot keeps the dot centred on the title line's glyph box. */
const MARKER_SLOT_HEIGHT = 18;

/**
 * State marker on the trailing edge of a catalog row's title line. Attention
 * outranks unread; the caller decides which ones apply and names each for
 * screen readers.
 */
export type CatalogRowMarker =
  | { readonly kind: "attention"; readonly label: string }
  | { readonly kind: "unread"; readonly label: string };

/**
 * Text column of a catalog row: the title line above the subtitle line. Every
 * catalog list (Threads, Pull requests) renders rows through these parts, so
 * typography, line spacing and trailing meta never differ between catalogs.
 * None of the parts accepts a style; callers supply content only.
 */
export function CatalogRowBody({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <View style={styles.body}>{children}</View>;
}

/** First line: leading mark, title, status accessories and trailing meta. */
export function CatalogRowTitleLine({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return <View style={styles.line}>{children}</View>;
}

/** Second line: the subtitle followed by compact badges. */
export function CatalogRowSubtitleLine({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return <View style={styles.line}>{children}</View>;
}

/** Leading provider or server mark, vertically centred on the title's line box. */
export function CatalogRowLeading({
  accessibilityLabel,
  children,
}: {
  /** Spoken name of the mark; omit when the row announces it itself. */
  readonly accessibilityLabel?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return accessibilityLabel === undefined ? (
    <View style={styles.leading}>{children}</View>
  ) : (
    <View accessibilityLabel={accessibilityLabel} accessible style={styles.leading}>
      {children}
    </View>
  );
}

/**
 * Row title in the catalog title role: one line, a leading emoji rendered in
 * its own glyph slot, and the shared text shimmer while the item is active.
 * It takes the free width of the title line.
 */
export function CatalogRowTitle({
  running,
  value,
}: {
  /** Shows the geometry-neutral shimmer instead of plain text. */
  readonly running: boolean;
  readonly value: string;
}): React.JSX.Element {
  const emoji = leadingEmoji(value);
  const stripped = emoji === null ? value : value.slice(emoji.length).trimStart();
  const text = stripped === "" ? value : stripped;
  return (
    <View style={styles.titleSlot}>
      <View style={styles.titleContent}>
        {emoji !== null &&
          stripped !== "" && (
            // WHY: `role` is InlineEmoji's type-scale role for glyph sizing, not an ARIA role.
            // oxlint-disable-next-line react-doctor/aria-role
            <InlineEmoji role="body" value={emoji} />
          )}
        {running ? (
          <WaveText
            containerStyle={styles.titleWave}
            style={styles.title}
            testID="catalog-row-title-shimmer"
            text={text}
          />
        ) : (
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={styles.title}
            testID="catalog-row-title"
          >
            {text}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Trailing meta of the title line: the state markers, caller indicators (for
 * example a provider slot) and the compact age.
 */
export function CatalogRowTrailing({
  age,
  ageTestID,
  children,
  markers,
}: {
  readonly age: string;
  readonly ageTestID?: string;
  readonly children?: ReactNode;
  /** Independent states in display order, each kind at most once. */
  readonly markers: readonly CatalogRowMarker[];
}): React.JSX.Element {
  return (
    <View style={styles.trailing}>
      {markers.map((marker) => (
        <Marker key={marker.kind} marker={marker} />
      ))}
      {children}
      <Text numberOfLines={1} style={styles.age} testID={ageTestID ?? "catalog-row-age"}>
        {age}
      </Text>
    </View>
  );
}

/** One-line secondary text of a row; it takes the free width of its line. */
export function CatalogRowSubtitle({
  testID,
  text,
}: {
  readonly testID?: string;
  readonly text: string;
}): React.JSX.Element {
  return (
    <Text
      ellipsizeMode="tail"
      numberOfLines={1}
      style={styles.subtitle}
      testID={testID ?? "catalog-row-subtitle"}
    >
      {text}
    </Text>
  );
}

/** Short numeric meta inside a subtitle badge, in the subtitle's role. */
export function CatalogRowMetaText({ children }: { readonly children: string }): React.JSX.Element {
  return (
    <Text numberOfLines={1} style={styles.metaText}>
      {children}
    </Text>
  );
}

function Marker({ marker }: { readonly marker: CatalogRowMarker }): React.JSX.Element {
  if (marker.kind === "unread") {
    return (
      <View style={styles.markerSlot}>
        <View accessibilityLabel={marker.label} accessible style={styles.unreadDot} />
      </View>
    );
  }
  return (
    <View accessibilityLabel={marker.label} accessible style={styles.iconMarker}>
      <Ionicons color={colors.text} name="hand-left-outline" size={iconSize.indicator} />
    </View>
  );
}

const styles = StyleSheet.create({
  age: {
    ...typeScale.caption,
    color: colors.textMuted,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  body: {
    flex: 1,
    gap: spacing.optical,
    maxWidth: "100%",
    minWidth: 0,
  },
  iconMarker: {
    alignItems: "center",
    flexShrink: 0,
    height: iconSize.indicator,
    justifyContent: "center",
    width: iconSize.indicator,
  },
  leading: {
    alignItems: "center",
    flexShrink: 0,
    height: typeScale.body.lineHeight,
    justifyContent: "center",
  },
  line: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  markerSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: MARKER_SLOT_HEIGHT,
    justifyContent: "center",
    width: UNREAD_DOT_SIZE,
  },
  metaText: {
    ...typeScale.label,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  subtitle: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
    maxWidth: "100%",
    minWidth: 0,
  },
  titleContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    maxWidth: "100%",
    minWidth: 0,
  },
  titleSlot: {
    alignItems: "flex-start",
    flex: 1,
    minWidth: 0,
  },
  titleWave: { maxWidth: "100%" },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xxs,
  },
  unreadDot: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexShrink: 0,
    height: UNREAD_DOT_SIZE,
    width: UNREAD_DOT_SIZE,
  },
});
