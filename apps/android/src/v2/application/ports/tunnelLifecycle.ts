export interface TunnelLifecycleProps {
  expiresAt: number;
  now(): number;
  onDispose(tunnelId: string): void;
  onExpire(): void;
  tunnelId: string;
}
