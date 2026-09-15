import { type RenderBlock } from "@codewide/renderers";
import { type StyleProp, type ViewStyle } from "react-native";
import { type PrivateAssetSource } from "../../../data/private-transfer";

export type ImageProtocolBlockInput = {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
};

export type ImageProtocolContentInput = {
  block: RenderBlock;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
};

export type ScopedRemoteImageInput = {
  path: string;
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
  containerStyle?: StyleProp<ViewStyle>;
  previewId?: string;
  groupId?: string | null;
  order?: number;
};

export type ScopedPrivateAssetImageInput = {
  source: PrivateAssetSource;
  label: string;
  reference: string;
  getTransferAccess(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
  containerStyle?: StyleProp<ViewStyle>;
  previewId?: string;
  groupId?: string | null;
  order?: number;
};
