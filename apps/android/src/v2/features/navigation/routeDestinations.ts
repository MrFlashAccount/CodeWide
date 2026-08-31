import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { SavedServerId } from "../../domain/ids";

export const serverDestination = (id: SavedServerId): `/servers/${string}` =>
  `/servers/${encodeURIComponent(id)}`;
export const threadDestination = (owner: QualifiedThread): `/servers/${string}/threads/${string}` =>
  `/servers/${encodeURIComponent(owner.savedServerId)}/threads/${encodeURIComponent(owner.threadId)}`;
export const agentDestination = (
  owner: QualifiedThread,
  agentThreadId: string,
): `/servers/${string}/threads/${string}/agents/${string}` =>
  `/servers/${encodeURIComponent(owner.savedServerId)}/threads/${encodeURIComponent(owner.threadId)}/agents/${encodeURIComponent(agentThreadId)}`;
export const portDestination = (
  savedServerId: SavedServerId,
  profileId: string,
): `/servers/${string}/ports/${string}` =>
  `/servers/${encodeURIComponent(savedServerId)}/ports/${encodeURIComponent(profileId)}`;
export const newThreadDestination = (id: SavedServerId): `/servers/${string}/new` =>
  `/servers/${encodeURIComponent(id)}/new`;
export const portsDestination = (id: SavedServerId): `/servers/${string}/ports` =>
  `/servers/${encodeURIComponent(id)}/ports`;
export const serverSettingsDestination = (id: SavedServerId): `/settings/servers/${string}` =>
  `/settings/servers/${encodeURIComponent(id)}`;
export const accountSettingsDestination = (id: SavedServerId): `/settings/accounts/${string}` =>
  `/settings/accounts/${encodeURIComponent(id)}`;
export const threadResourceDestination = (
  owner: QualifiedThread,
  resource: "agents" | "attachments" | "changes" | "terminal",
): `/servers/${string}/threads/${string}/${string}` =>
  `/servers/${encodeURIComponent(owner.savedServerId)}/threads/${encodeURIComponent(owner.threadId)}/${resource}`;
