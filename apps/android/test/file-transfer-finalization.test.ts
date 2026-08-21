import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/native/file-transfer.native.ts", import.meta.url), "utf8");
const nativeModule = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt", import.meta.url), "utf8");
const documentPreviewHost = readFileSync(new URL("../src/rendering/DocumentPreviewHost.tsx", import.meta.url), "utf8");
const heroUIRoot = readFileSync(new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url), "utf8");
const expoFileHandlePatch = readFileSync(new URL("../../../patches/expo-file-system@57.0.2.patch", import.meta.url), "utf8");

describe("Android download finalization", () => {
  it("does not rename Storage Access Framework content URIs", () => {
    expect(source).toContain('if (!partial.uri.startsWith("content://"))');
    expect(source).toContain("partial.rename(filename)");
    expect(source).toContain("const completed = directory.createFile(filename, mimeType)");
    expect(source).toContain("await copyFileContents(");
  });

  it("keeps a verified download recoverable until the exported file is durable", () => {
    const createIndex = source.indexOf("const completed = directory.createFile(filename, mimeType)");
    const verifyIndex = source.indexOf("completedHash !== expectedHash", createIndex);
    const cleanupIndex = source.indexOf("deleteBestEffort(partial)", verifyIndex);
    expect(createIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(createIndex);
    expect(cleanupIndex).toBeGreaterThan(verifyIndex);
    expect(source).toContain('throw new Error("Saved file failed SHA-256 integrity verification")');
  });

  it("treats an already exported identical file as an idempotent success", () => {
    expect(source).toContain("existing.size === expectedBytes");
    expect(source).toContain("existingHash === expectedHash");
    expect(source).toContain("return existing");
  });

  it("reports success non-modally through the native HeroUI toast", () => {
    expect(heroUIRoot).toContain('from "heroui-native/toast"');
    expect(heroUIRoot).toContain("<ToastProvider");
    expect(heroUIRoot).toContain('insets={{ left: 16, right: 16 }}');
    expect(heroUIRoot).not.toContain("bottom: 20");
    expect(documentPreviewHost).toContain('variant: "success"');
    expect(documentPreviewHost).toContain('label: "File saved"');
    expect(documentPreviewHost).toContain('<Toast.Action');
    expect(documentPreviewHost).toContain('variant="primary"');
    expect(documentPreviewHost).toContain('style={styles.downloadToastAction}');
    expect(documentPreviewHost).toContain('downloadToastAction: { backgroundColor: colors.primary }');
    expect(documentPreviewHost).not.toContain('dialog.alert("Download complete"');
  });

  it("keeps the SAF parcel descriptor owned for the complete file-handle lifetime", () => {
    expect(expoFileHandlePatch).toContain("private val resourceOwner: Closeable? = null");
    expect(expoFileHandlePatch).toContain("ParcelFileDescriptor.AutoCloseInputStream(pfd)");
    expect(expoFileHandlePatch).toContain("ParcelFileDescriptor.AutoCloseOutputStream(pfd)");
    expect(expoFileHandlePatch).toContain("resourceOwner?.close() ?: fileChannel.close()");
  });

  it("grants the selected viewer temporary read access to the saved content URI", () => {
    expect(source).toContain("fileViewerBridge.openDocument(uri, mimeType ?? null)");
    expect(nativeModule).toContain("fun openDocument(uriValue: String, mimeType: String?, promise: Promise)");
    expect(nativeModule).toContain("Intent.FLAG_GRANT_READ_URI_PERMISSION");
    expect(nativeModule).toContain('require(uri.scheme == "content")');
    expect(nativeModule).not.toContain("intent.resolveActivity(context.packageManager)");
    expect(nativeModule).toContain("context.startActivity(intent)");
    expect(nativeModule).toContain("catch (error: ActivityNotFoundException)");
  });
});
