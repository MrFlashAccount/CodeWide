export type V2PublicFailure = {
  code:
    | "offline"
    | "notFound"
    | "notAvailable"
    | "rejected"
    | "failed"
    | "notCreated"
    | "durableUnsettled";
  message: string;
  retryable: boolean;
};
