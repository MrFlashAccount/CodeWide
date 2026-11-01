/**
 * The wire names of the Global Supervisor dynamic tools, keyed by the legacy
 * camelCase name each tool had before CodeWide prefixed every agent-facing
 * tool with `codewide_`. New supervisor threads declare only the prefixed
 * names.
 */
export const globalSupervisorToolNames = {
  findChat: "codewide_find_chat",
  followChat: "codewide_follow_chat",
  inspectChat: "codewide_inspect_chat",
  interruptChat: "codewide_interrupt_chat",
  listActiveWork: "codewide_list_active_work",
  listChatAttachments: "codewide_list_chat_attachments",
  listChats: "codewide_list_chats",
  readChat: "codewide_read_chat",
  readChatAttachment: "codewide_read_chat_attachment",
  respondToRequest: "codewide_respond_to_request",
  sendText: "codewide_send_text",
  setSpokenAttention: "codewide_set_spoken_attention",
  startTask: "codewide_start_task",
  unfollowChat: "codewide_unfollow_chat",
} as const;

/** One Global Supervisor dynamic tool, by its current wire name. */
export type GlobalSupervisorToolName =
  (typeof globalSupervisorToolNames)[keyof typeof globalSupervisorToolNames];

const toolNameByWireName: ReadonlyMap<string, GlobalSupervisorToolName> = new Map(
  Object.entries(globalSupervisorToolNames).flatMap(
    ([legacy, current]): (readonly [string, GlobalSupervisorToolName])[] => [
      [current, current],
      // Codex restores a thread's dynamic tools from its rollout and `thread/resume`
      // cannot redeclare them, so threads created before the rename keep calling
      // the legacy names.
      [legacy, current],
    ],
  ),
);

/** The current name of a called tool, accepting legacy names; `null` for any other tool. */
export function globalSupervisorToolName(tool: unknown): GlobalSupervisorToolName | null {
  return typeof tool === "string" ? (toolNameByWireName.get(tool) ?? null) : null;
}
