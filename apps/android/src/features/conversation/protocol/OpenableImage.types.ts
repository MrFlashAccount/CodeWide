import { type StyleProp, type ViewStyle } from "react-native";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type OpenableImageProps = {
  label: string;
  source: { uri: string; headers?: Record<string, string> };
  variant?: "generated" | "user";
  containerStyle?: StyleProp<ViewStyle>;
  previewId?: string;
  groupId?: string | null;
  order?: number;
  reference?: string | null;
  link?: string | null;
  download?: (() => Promise<void>) | null;
  onError?(): void;
};
