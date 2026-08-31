export type Action = { disabled?: boolean; id: string; label: string; run(): Promise<void> | void };
