# Companion transport recovery, 2026-09-22

## Evidence and scope

The Companion process remained healthy (no restarts, approximately 133 MiB RSS).
Local health took 0.5 ms; a local App Server bridge opened in 4 ms and returned
`thread/list` in 8 ms. Android telemetry recorded outer-carrier HTTP 502 responses
and twenty RPC timeouts in the captured sample, with 30-second deadlines.

The direct host-to-FRP route through NAT64 retransmitted approximately one third
of its transmitted bytes. Small ICMP probes also lost 30–50% of packets. Both
available source IPv6 addresses reproduced the loss. Direct IPv4 was unreachable;
uploading 1 MiB through SSH exceeded twenty seconds. This identifies the affected
route, but does not identify the carrier/hop responsible for its packet loss.

The repair bypasses that route for this FRP client. Companion was not restarted;
no Android release, app data migration, proxy ACL relaxation, or global network
change was needed. A wholesale Relay migration was unnecessary for recovery.

## Active transport

1. `frpc-codex-remote.service` connects to local port 17443 using FRP `websocket`
   transport, with its existing token and TLS enabled inside the WebSocket.
2. Only this Docker container maps `monitoring.garin.dev` to loopback, preserving
   the correct HTTP Host while directing the connection to the local transport.
3. `codewide-frp-transport.service` runs the installed stunnel. It establishes an
   authenticated CONNECT through the existing local managed proxy, then outer
   TLS to `monitoring.garin.dev:443`. It verifies the public certificate chain
   and hostname. The proxy's existing failover policy is unchanged.
4. The monitoring Nginx server handles exactly `/~!frp`, forwarding WebSocket
   bytes to `http://127.0.0.1:7000`. FRP's required TLS remains **inside** those
   bytes; `transport.tls.force = true` is unchanged on frps. The application's
   separate phone-to-Companion TLS/mTLS also remains unchanged.

The existing frps instance expects TLS inside its WebSocket. Consequently, direct
FRP `wss` behind a TLS-terminating HTTP proxy is not used: the installed stunnel
provides outer TLS while FRP `websocket` retains its inner TLS. See the installed
version's [connector](https://github.com/fatedier/frp/blob/v0.68.0/client/connector.go)
and [listener](https://github.com/fatedier/frp/blob/v0.68.0/server/service.go).

Local configuration lives under `~/.config/frp/` and the user systemd directory.
`transport-stunnel.conf` contains proxy credentials and must remain mode 0600;
refresh those credentials there when rotating the managed proxy credentials.
Both transport services are enabled at login, and FRP depends on the transport.

On the monitoring host, `/root/overrides/monitoring-frp.conf` is mounted read-only
over Nginx's monitoring server configuration through `/root/docker-compose.yml`.
Preserve that mount during subsequent edge deployments. SSH is available on port
27494; the local agent environment did not contain the user's `monitor` alias.

## Validation and rollback

Before switching the production client, a separate FRP client with no published
proxies successfully authenticated through the new path. Compose, Nginx, FRP,
and systemd configuration checks passed.

After the switch at 01:16 MSK, the public `/v1/e2ee-tunnel` opened in 115–163 ms.
Fifty sequential WebSocket ping/pong checks passed: median 53 ms, p95 93 ms,
maximum 94 ms. The new outbound connection initially showed no retransmissions,
and the services showed no automatic restarts or new FRP errors during the check.
This verifies the public tunnel; it is not an authenticated phone RPC or UI test.
The newest available phone telemetry still preceded the change.

Backups:

- Local: `~/.config/frp/backup-20260921T221617Z/`, containing the original FRP
  configuration and service unit.
- Monitoring host: `/root/overrides/frp-transport-backup-20260921T220919Z/`,
  containing the original Compose file and monitoring Nginx configuration.

For rollback, restore the two local files, remove the added FRP `transport.conf`
systemd drop-in, reload user systemd, and restart only `frpc-codex-remote.service`.
Then stop and disable the new transport service. This restores the original
direct route, including its observed network problem. The unused edge path may
be removed separately by restoring the monitoring configuration/mount after
checking for intervening edits. Do not overwrite unrelated later changes.
