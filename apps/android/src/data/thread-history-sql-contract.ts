/** SQL boundary shared by native persistence and migration verification. */
type HistorySqlValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView;
/** Callers own the transaction encompassing chain publication and content writes. */
export type HistoryExecutor = {
  execute: (sql: string, params?: readonly HistorySqlValue[]) => Promise<unknown>;
};
