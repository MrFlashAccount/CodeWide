import { Platform, requireNativeComponent, UIManager, type ViewProps } from "react-native";

type PosterProps = ViewProps & {
  readonly onPosterError: () => void;
  readonly sourceUri: string;
};

const hostName = "CodeWideVideoPoster";
/** Native thumbnail renderer when the installed Android shell provides it. */
export const PosterHost =
  Platform.OS === "android" && UIManager.hasViewManagerConfig(hostName)
    ? requireNativeComponent<PosterProps>(hostName)
    : null;
