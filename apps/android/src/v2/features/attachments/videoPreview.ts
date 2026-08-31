const VIDEO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogv",
  "ts",
  "webm",
]);

const LOCAL_VIDEO_SCHEMES = new Set(["content:", "file:"]);
const MAX_ID_LENGTH = 256;
const MAX_LABEL_LENGTH = 1024;
const MAX_MEDIA_TYPE_LENGTH = 256;
const MAX_SOURCE_URI_LENGTH = 8192;

export interface VideoPlaybackSource {
  uri: string;
}

export interface VideoPreviewRouteModel {
  attachmentId: string;
  mediaType: string;
  name: string;
  savedServerId: string;
  source: VideoPlaybackSource;
  threadId: string;
}

export interface VideoPreviewRouteInput {
  attachmentId?: string | readonly string[];
  mediaType?: string | readonly string[];
  name?: string | readonly string[];
  savedServerId?: string | readonly string[];
  sourceUri?: string | readonly string[];
  threadId?: string | readonly string[];
}

export type VideoPreviewRouteResult =
  | { model: VideoPreviewRouteModel; ok: true }
  | { message: string; ok: false };

function isVideoAttachment(name: string, mediaType: string): boolean {
  const normalizedMediaType = mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalizedMediaType.startsWith("video/")) {
    return true;
  }
  const extension = name.split(/[?#]/u, 1)[0]?.split(".").at(-1)?.toLowerCase();
  return extension !== undefined && VIDEO_EXTENSIONS.has(extension);
}

export function parseVideoPreviewRoute(input: VideoPreviewRouteInput): VideoPreviewRouteResult {
  const fields = readRouteFields(input);
  const invalid = invalidRouteMessage(fields);
  return invalid === null ? validRoute(fields) : { message: invalid, ok: false };
}

interface RouteFields {
  attachmentId: string | null;
  mediaType: string | null;
  name: string | null;
  savedServerId: string | null;
  sourceUri: string | null;
  threadId: string | null;
}

function readRouteFields(input: VideoPreviewRouteInput): RouteFields {
  return {
    attachmentId: scalar(input.attachmentId),
    mediaType: scalar(input.mediaType),
    name: scalar(input.name),
    savedServerId: scalar(input.savedServerId),
    sourceUri: scalar(input.sourceUri),
    threadId: scalar(input.threadId),
  };
}

function invalidRouteMessage(fields: RouteFields): string | null {
  if (!validId(fields.savedServerId)) {
    return "Video identity is invalid";
  }
  if (!validId(fields.threadId)) {
    return "Video identity is invalid";
  }
  if (!validId(fields.attachmentId)) {
    return "Video identity is invalid";
  }
  if (!validName(fields.name)) {
    return "Video name is invalid";
  }
  if (!validVideoType(fields.name, fields.mediaType)) {
    return "This attachment is not a supported video";
  }
  if (!validSourceUri(fields.sourceUri)) {
    return "Video must be materialized in private local storage before playback";
  }
  return null;
}

function validRoute(fields: RouteFields): VideoPreviewRouteResult {
  // WHY: invalidRouteMessage proves every nullable field before this constructor.
  if (!completeRoute(fields)) {
    return { message: "Video preview is invalid", ok: false };
  }
  return {
    model: {
      attachmentId: fields.attachmentId,
      mediaType: fields.mediaType,
      name: fields.name,
      savedServerId: fields.savedServerId,
      source: { uri: fields.sourceUri },
      threadId: fields.threadId,
    },
    ok: true,
  };
}

function completeRoute(fields: RouteFields): fields is {
  attachmentId: string;
  mediaType: string;
  name: string;
  savedServerId: string;
  sourceUri: string;
  threadId: string;
} {
  return (
    fields.attachmentId !== null &&
    fields.mediaType !== null &&
    fields.name !== null &&
    fields.savedServerId !== null &&
    fields.sourceUri !== null &&
    fields.threadId !== null
  );
}

function validName(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= MAX_LABEL_LENGTH;
}

function validVideoType(name: string | null, mediaType: string | null): boolean {
  if (name === null || mediaType === null || mediaType.length > MAX_MEDIA_TYPE_LENGTH) {
    return false;
  }
  return isVideoAttachment(name, mediaType);
}

function validSourceUri(value: string | null): value is string {
  return value !== null && value.length <= MAX_SOURCE_URI_LENGTH && isLocalVideoUri(value);
}

function scalar(value: string | readonly string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function validId(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isLocalVideoUri(value: string): boolean {
  try {
    return LOCAL_VIDEO_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
