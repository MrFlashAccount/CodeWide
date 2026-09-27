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
  const [iconId, setIconId] = useState(connection.iconId);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [replacementToken, setReplacementToken] = useState("");
  const [tlsPinSha256, setTlsPinSha256] = useState(connection.tlsPinSha256 ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelEditing = useEvent(() => {
    setName(connection.displayName);
    setIconId(connection.iconId);
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
      endpoint,
      iconId,
      ...(replacementToken.trim() === "" ? {} : { token: replacementToken }),
      ...(tlsPinSha256.trim() === "" ? {} : { tlsPinSha256 }),
    };
    try {
      await onUpdate(connection.id, input);
      setReplacementToken("");
      setEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update server");
    }
    setSaving(false);
  });
  return {
    cancelEditing,
    editing,
    endpoint,
    error,
    iconId,
    name,
    replacementToken,
    save,
    saving,
    setEditing,
    setEndpoint,
    setIconId,
    setName,
    setReplacementToken,
    setTlsPinSha256,
    tlsPinSha256,
  };
}

/** State machine returned by the connection profile editor. */
export type ConnectionEditor = ReturnType<typeof useConnectionEditor>;
