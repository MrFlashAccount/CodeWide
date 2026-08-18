type RpcObject = Record<string, unknown>;

export type RemoteFileResolver = (rootId: string, relativePath: string) => Promise<string>;

const MAX_REMOTE_FILES = 128;
const MAX_FIELD_CHARS = 4_096;

/**
 * Converts the companion-only remoteFile input into the App Server's local
 * input variants. The Android client never gets to choose an absolute host
 * path: every reference is resolved again against a configured file root.
 */
export async function prepareRemoteFileInputs(
  method: string,
  params: RpcObject,
  resolveFile: RemoteFileResolver,
): Promise<RpcObject> {
  if (method !== "turn/start" && method !== "turn/steer") return params;
  if (!Array.isArray(params.input)) return params;
  let remoteFiles = 0;
  const input = await Promise.all(params.input.map(async (raw): Promise<unknown> => {
    const part = asObject(raw);
    if (part?.type !== "remoteFile") return raw;
    remoteFiles += 1;
    if (remoteFiles > MAX_REMOTE_FILES) throw new Error("Too many remote file inputs");
    const rootId = boundedString(part.rootId, "rootId");
    const relativePath = boundedString(part.path, "path");
    const name = boundedString(part.name, "name");
    const kind = part.kind;
    if (kind !== "image" && kind !== "audio" && kind !== "file") throw new Error("Invalid remote file kind");
    const hostPath = await resolveFile(rootId, relativePath);
    if (kind === "image") return { type: "localImage", path: hostPath };
    if (kind === "audio") return { type: "localAudio", path: hostPath };
    return { type: "mention", name, path: hostPath };
  }));
  return { ...params, input };
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_FIELD_CHARS || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid remote file ${field}`);
  }
  return value;
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}
