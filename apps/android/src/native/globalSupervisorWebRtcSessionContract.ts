type GlobalSupervisorWebRtcMode = "interactive" | "preview";

/** One device-owned WebRTC media session negotiated through Codex app-server. */
export type GlobalSupervisorWebRtcSession = {
  readonly acceptAnswer: (sdp: string) => Promise<void>;
  readonly offerSdp: string;
  readonly stop: () => Promise<void>;
};

/** Creates one microphone/full-duplex or receive-only GPT Live media session. */
export type GlobalSupervisorWebRtcSessionFactory = (
  options:
    | {
        readonly mode: Extract<GlobalSupervisorWebRtcMode, "interactive">;
        readonly onLevel: (level: number) => void;
        readonly onTerminal: () => void;
      }
    | {
        readonly mode: Extract<GlobalSupervisorWebRtcMode, "preview">;
        readonly onTerminal: () => void;
      },
) => Promise<GlobalSupervisorWebRtcSession>;
