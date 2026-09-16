import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import type { SkillPlugin } from "../data/skill-catalog-types";
import {
  readPrivateAssetText,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";
import { usePrivateAssetUri, usePrivateFileAccessScope } from "../rendering/use-private-image-uri";
import { useAsyncResource } from "../rendering/async-resource-store";
import { privateImageResourceKey } from "../rendering/private-image-resource-key";
import { colors, iconSize, radii } from "../theme";
import { InlineIcon } from "./InlineIcon";

/** Plugin artwork uses the same scoped private transfer pipeline as message images. */
export function SkillPluginIcon({
  getTransferAccess,
  plugin,
}: {
  getTransferAccess?: GetTransferAccess;
  plugin: SkillPlugin | null;
}) {
  const icon = plugin?.icon ?? null;
  const path = icon?.kind === "path" ? icon.path : icon?.kind === "remote" ? icon.url : "";
  if (icon !== null && /\.svg(?:$|[?#])/iu.test(path)) {
    return (
      <SvgPluginIcon
        source={icon}
        {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
      />
    );
  }
  return <RasterPluginIcon plugin={plugin} />;
}

function SvgPluginIcon({
  getTransferAccess,
  source,
}: {
  getTransferAccess?: GetTransferAccess;
  source: PrivateAssetSource;
}) {
  const scope = usePrivateFileAccessScope();
  const key = `plugin-icon:${scope}:${privateImageResourceKey(source)}`;
  const [failed, setFailed] = useState(false);
  const svg = useAsyncResource<string>(key, key, async (_publish, signal) => {
    const result = await readPrivateAssetText(source, getTransferAccess ?? null, {
      limit: 128 * 1024,
      signal,
    });
    if (result.truncated) {
      throw new Error("Plugin icon exceeds preview size");
    }
    return result.text;
  });
  return (
    <View accessible={false} style={styles.frame}>
      {svg.value !== null && !failed ? (
        <SvgXml
          height="100%"
          onError={() => {
            setFailed(true);
          }}
          width="100%"
          xml={svg.value}
        />
      ) : (
        <InlineIcon color={colors.textMuted} name="extension-puzzle-outline" role="label" />
      )}
    </View>
  );
}

function RasterPluginIcon({ plugin }: { plugin: SkillPlugin | null }) {
  const source = usePrivateAssetUri(plugin?.icon ?? null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <View accessible={false} style={styles.frame}>
      {source.uri !== null && source.uri !== failedUri ? (
        <Image
          onError={() => {
            setFailedUri(source.uri);
          }}
          resizeMode="contain"
          source={{ uri: source.uri }}
          style={styles.image}
        />
      ) : (
        <InlineIcon
          color={colors.textMuted}
          name={plugin === null ? "sparkles-outline" : "extension-puzzle-outline"}
          role="label"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    borderRadius: radii.compact,
    height: iconSize.navigation,
    justifyContent: "center",
    overflow: "hidden",
    width: iconSize.navigation,
  },
  image: {
    height: "100%",
    width: "100%",
  },
});
