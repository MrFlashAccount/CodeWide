import { useState, type ReactElement } from "react";
import { StyleSheet } from "react-native";

import { useEvent } from "../react/useEvent";
import { PosterHost } from "./nativeVideoPosterHost";

/** Displays a cached video's first frame in chat. Streams and unsupported files use the player. */
export function InlineVideoPoster({
  children,
  uri,
}: {
  readonly children: ReactElement;
  readonly uri: string;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const fallback = useEvent(() => {
    setFailed(true);
  });
  if (PosterHost === null || failed || !uri.startsWith("file://")) {
    return children;
  }
  return (
    <PosterHost
      accessible={false}
      onPosterError={fallback}
      pointerEvents="none"
      sourceUri={uri}
      style={StyleSheet.absoluteFill}
    />
  );
}
