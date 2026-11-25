/** Name the download actually occupies in the selected device folder. */
export function downloadFilename(remotePath: string): string {
  const filename = remotePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? "download";
  const portable = filename
    .split("")
    .map((character) => (safeFilenameCharacter(character) ? character : "-"))
    .join("")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^[.\s]+|[.\s]+$/gu, "")
    .slice(0, MAX_DOWNLOAD_FILENAME_LENGTH);
  return portable === "" ? "download" : portable;
}

const MIN_PRINTABLE_CODE_POINT = 32;
const DELETE_CODE_POINT = 127;
const MAX_DOWNLOAD_FILENAME_LENGTH = 180;

function safeFilenameCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint >= MIN_PRINTABLE_CODE_POINT &&
    codePoint !== DELETE_CODE_POINT &&
    !String.raw`\/:*?"<>|`.includes(character)
  );
}
