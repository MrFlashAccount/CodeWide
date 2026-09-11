import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";
import type { SkillPlugin } from "../data/skill-catalog-types";
import { readPrivateAssetText, type GetTransferAccess, type PrivateAssetSource } from "../data/private-transfer";
import { usePrivateAssetUri, usePrivateFileAccessScope } from "../rendering/use-private-image-uri";
import { useAsyncResource } from "../rendering/async-resource-store";
import { privateImageResourceKey } from "../rendering/private-image-resource-key";
import { colors, iconSize, radii } from "../theme";
import { InlineIcon } from "./InlineIcon";

/** Plugin artwork uses the same scoped private transfer pipeline as message images. */
export function SkillPluginIcon({ plugin, getTransferAccess }: { plugin: SkillPlugin | null; getTransferAccess?: GetTransferAccess }) {
  const icon = plugin?.icon ?? null;
  const path = icon?.kind === "path" ? icon.path : icon?.kind === "remote" ? icon.url : "";
  if (icon !== null && /\.svg(?:$|[?#])/iu.test(path)) {
    return <SvgPluginIcon source={icon} {...(getTransferAccess === undefined ? {} : { getTransferAccess })} />;
  }
  return <RasterPluginIcon plugin={plugin} />;
}

function SvgPluginIcon({ source, getTransferAccess }: { source: PrivateAssetSource; getTransferAccess?: GetTransferAccess }) {
  const scope = usePrivateFileAccessScope();
  const key = `plugin-icon:${scope}:${privateImageResourceKey(source)}`;
  const [failed, setFailed] = useState(false);
  const svg = useAsyncResource<string>(key, key, async (_publish, signal) => {
    const result = await readPrivateAssetText(source, getTransferAccess ?? null, { limit: 128 * 1024, signal });
    if (result.truncated) throw new Error("Plugin icon exceeds preview size");
    return result.text;
  });
  return <View accessible={false} style={styles.frame}>
    {svg.value !== null && !failed
      ? <SvgXml xml={svg.value} width="100%" height="100%" onError={() => setFailed(true)} />
      : <InlineIcon name="extension-puzzle-outline" role="label" color={colors.textMuted} />}
  </View>;
}

function RasterPluginIcon({ plugin }: { plugin: SkillPlugin | null }) {
  const source = usePrivateAssetUri(plugin?.icon ?? null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return <View accessible={false} style={styles.frame}>
    {source.uri !== null && source.uri !== failedUri
      ? <Image source={{ uri: source.uri }} resizeMode="contain" style={styles.image} onError={() => setFailedUri(source.uri)} />
      : <InlineIcon name={plugin === null ? "sparkles-outline" : "extension-puzzle-outline"} role="label" color={colors.textMuted} />}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: iconSize.navigation, height: iconSize.navigation, borderRadius: radii.compact, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
});
