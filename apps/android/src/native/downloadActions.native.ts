import { File } from "expo-file-system";
import { NativeModules } from "react-native";
import { unknownRecord } from "../data/unknownRecord";

type DocumentActions = {
  readonly renameDownload?: (uri: string, name: string) => Promise<unknown>;
  readonly shareDownloads?: (uris: readonly string[], mimeType: string | null) => Promise<void>;
};

// WHY: React Native exposes custom bridge modules without type declarations. Methods are
// optional on earlier runtimes and the document provider's result is validated below.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bridge = NativeModules.CodeWideNative as DocumentActions | undefined;

/** Renames the saved document and returns the name and URI assigned by its provider. */
export async function renameDownload(
  uri: string,
  name: string,
): Promise<{ name: string; uri: string }> {
  if (uri.startsWith("file://")) {
    const file = new File(uri);
    file.rename(name);
    return { name: file.name, uri: file.uri };
  }
  if (bridge?.renameDownload === undefined) {
    throw new Error("Renaming downloads requires a newer CodeWide APK");
  }
  const result = unknownRecord(await bridge.renameDownload(uri, name));
  if (typeof result?.name !== "string" || typeof result.uri !== "string") {
    throw new Error("Invalid renamed document");
  }
  return { name: result.name, uri: result.uri };
}

/** Grants the receiving Android app read access to the selected documents. */
export async function shareDownloads(
  uris: readonly string[],
  mimeType: string | null,
): Promise<void> {
  if (bridge?.shareDownloads === undefined) {
    throw new Error("Sharing downloads requires a newer CodeWide APK");
  }
  await bridge.shareDownloads(
    uris.map((uri) => (uri.startsWith("file://") ? new File(uri).contentUri : uri)),
    mimeType,
  );
}
