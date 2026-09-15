/** V1 ConnectionRowEditor owner, extracted without changing interaction or resource lifetime. */
import { useState } from "react";
import type { ConnectionUpdateInput } from "../../data/connection-validation";

import { useEvent } from "../../react/useEvent";
import type { ConnectionEditorProps } from "./connectionEditorContract";

/** Keeps unsaved profile fields and save failure local to the mounted connection row. */
export function useConnectionEditor({
  connection,
  onUpdate,
}: Pick<ConnectionEditorProps, "connection" | "onUpdate">) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(connection.displayName);
  const [emoji, setEmoji] = useState(connection.emoji);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [replacementToken, setReplacementToken] = useState("");
  const [tlsPinSha256, setTlsPinSha256] = useState(connection.tlsPinSha256 ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelEditing = useEvent(() => {
    setName(connection.displayName);
    setEmoji(connection.emoji);
    setEndpoint(connection.endpoint);
    setReplacementToken("");
    setTlsPinSha256(connection.tlsPinSha256 ?? "");
    setError(null);
    setEditing(false);
  });
  const save = useEvent(async () => {
    setSaving(true);
    setError(null);
    const input: ConnectionUpdateInput = {
      displayName: name,
      emoji,
      endpoint,
      ...(replacementToken.trim() === "" ? {} : { token: replacementToken }),
      ...(tlsPinSha256.trim() === "" ? {} : { tlsPinSha256 }),
    };
    try {
      await onUpdate(connection.id, input);
      setReplacementToken("");
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update server");
    }
    setSaving(false);
  });
  return {
    editing,
    setEditing,
    name,
    setName,
    emoji,
    setEmoji,
    endpoint,
    setEndpoint,
    replacementToken,
    setReplacementToken,
    tlsPinSha256,
    setTlsPinSha256,
    saving,
    error,
    cancelEditing,
    save,
  };
}

/** State machine returned by the connection profile editor. */
export type ConnectionEditor = ReturnType<typeof useConnectionEditor>;
