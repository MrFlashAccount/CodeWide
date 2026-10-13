import type { RenderBlock } from "@codewide/renderers";
import type { StyleProp, ViewStyle } from "react-native";
import type { PrivateAssetSource, TransferAccess } from "../../../data/private-transfer";

export type ImageProtocolBlockInput = {
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
};

export type ImageProtocolContentInput = {
  block: RenderBlock;
  getTransferAccess?: () => Promise<TransferAccess>;
};

export type ScopedRemoteImageInput = {
  containerStyle?: StyleProp<ViewStyle>;
  getTransferAccess: (forceRefresh?: boolean) => Promise<TransferAccess>;
  groupId?: string | null;
  order?: number;
  path: string;
  previewId?: string;
};

export type ScopedPrivateAssetImageInput = {
  containerStyle?: StyleProp<ViewStyle>;
  getTransferAccess: (forceRefresh?: boolean) => Promise<TransferAccess>;
  groupId?: string | null;
  label: string;
  order?: number;
  previewId?: string;
  reference: string;
  source: PrivateAssetSource;
};
