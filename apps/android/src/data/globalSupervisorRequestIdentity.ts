import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

type GlobalSupervisorRequestIdentity = {
  readonly connectionId: string;
  readonly requestId: string | number;
};

/** Derives a fixed-length, content-free command id from one qualified home request. */
export async function globalSupervisorRequestCommandId(
  purpose: "response" | "targetSend" | "workerCreate",
  identity: GlobalSupervisorRequestIdentity,
): Promise<string> {
  const digest = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([identity.connectionId, typeof identity.requestId, identity.requestId, purpose]),
  );
  return `global-supervisor-${purpose}-${digest}`;
}
