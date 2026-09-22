import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";

/** Adapts route composition to the existing owner-qualified feature command groups. */
export const workspaceCapabilities = {
  browserFeedback: {
    sendText: async (
      ...args: Parameters<typeof features.composer.sendText>
    ): ReturnType<typeof features.composer.sendText> => {
      const commandId = await features.composer.sendText(...args);
      return commandId;
    },
    transferAccess: async (
      ...args: Parameters<typeof features.attachments.transferAccess>
    ): ReturnType<typeof features.attachments.transferAccess> => {
      const access = await features.attachments.transferAccess(...args);
      return access;
    },
  },
  connection: {
    addConnection: async (
      ...args: Parameters<typeof features.connections.addConnection>
    ): ReturnType<typeof features.connections.addConnection> => {
      const connection = await features.connections.addConnection(...args);
      return connection;
    },
    deleteConnection: async (
      ...args: Parameters<typeof features.connections.deleteConnection>
    ): ReturnType<typeof features.connections.deleteConnection> => {
      await features.connections.deleteConnection(...args);
    },
    moveConnection: async (
      ...args: Parameters<typeof features.connections.moveConnection>
    ): ReturnType<typeof features.connections.moveConnection> => {
      await features.connections.moveConnection(...args);
    },
    reconnectConnection: async (
      ...args: Parameters<typeof features.connections.reconnectConnection>
    ): ReturnType<typeof features.connections.reconnectConnection> => {
      await features.connections.reconnectConnection(...args);
    },
    setConnectionEnabled: async (
      ...args: Parameters<typeof features.connections.setConnectionEnabled>
    ): ReturnType<typeof features.connections.setConnectionEnabled> => {
      await features.connections.setConnectionEnabled(...args);
    },
    updateConnection: async (
      ...args: Parameters<typeof features.connections.updateConnection>
    ): ReturnType<typeof features.connections.updateConnection> => {
      await features.connections.updateConnection(...args);
    },
    updateConnectionProfile: async (
      ...args: Parameters<typeof features.connections.updateConnectionProfile>
    ): ReturnType<typeof features.connections.updateConnectionProfile> => {
      await features.connections.updateConnectionProfile(...args);
    },
  },
  recovery: {
    renameThread: async (
      ...args: Parameters<typeof features.turnActions.renameThread>
    ): ReturnType<typeof features.turnActions.renameThread> => {
      await features.turnActions.renameThread(...args);
    },
    sendText: async (
      ...args: Parameters<typeof features.composer.sendText>
    ): ReturnType<typeof features.composer.sendText> => {
      const commandId = await features.composer.sendText(...args);
      return commandId;
    },
    startThread: async (
      ...args: Parameters<typeof features.projects.startThread>
    ): ReturnType<typeof features.projects.startThread> => {
      const threadId = await features.projects.startThread(...args);
      return threadId;
    },
  },
  refreshAccountRateLimits: async (
    ...args: Parameters<typeof features.accounts.refreshAccountRateLimits>
  ): ReturnType<typeof features.accounts.refreshAccountRateLimits> => {
    const limits = await features.accounts.refreshAccountRateLimits(...args);
    return limits;
  },
  threadListActions: {
    archiveThread: async (
      ...args: Parameters<typeof features.turnActions.archiveThread>
    ): ReturnType<typeof features.turnActions.archiveThread> => {
      await features.turnActions.archiveThread(...args);
    },
    markThreadRead: async (
      ...args: Parameters<typeof features.turnActions.markThreadRead>
    ): ReturnType<typeof features.turnActions.markThreadRead> => {
      await features.turnActions.markThreadRead(...args);
    },
    setThreadPinned: async (
      ...args: Parameters<typeof features.turnActions.setThreadPinned>
    ): ReturnType<typeof features.turnActions.setThreadPinned> => {
      await features.turnActions.setThreadPinned(...args);
    },
    unarchiveThread: async (
      ...args: Parameters<typeof features.turnActions.unarchiveThread>
    ): ReturnType<typeof features.turnActions.unarchiveThread> => {
      await features.turnActions.unarchiveThread(...args);
    },
  },
};
