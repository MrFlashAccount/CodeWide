import type { StyleProp, ViewStyle } from "react-native";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type OpenableImageProps = {
  containerStyle?: StyleProp<ViewStyle>;
  download?: (() => Promise<void>) | null;
  groupId?: string | null;
  label: string;
  link?: string | null;
  onError?: () => void;
  order?: number;
  previewId?: string;
  reference?: string | null;
  source: { headers?: Record<string, string>; uri: string };
  variant?: "generated" | "user";
};
