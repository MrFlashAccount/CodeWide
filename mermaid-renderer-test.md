# Mermaid renderer test

Этот файл проверяет inline-рендер, ширину bubble, fullscreen, pan и zoom.

## Remote connection flow

```mermaid
flowchart LR
  Phone[Android app] -->|HTTPS / WSS| Nginx[nginx TLS]
  Nginx --> FRPS[FRPS :8885]
  FRPS --> FRPC[FRPC on workstation]
  FRPC --> Companion[CodeWide :8765]
  Companion --> Codex[Codex app-server]
```

## Turn lifecycle

```mermaid
stateDiagram-v2
  [*] --> Queued
  Queued --> Sending
  Sending --> Running
  Running --> Completed
  Running --> Stopped
  Sending --> Failed
  Failed --> Sending: retry
  Completed --> [*]
  Stopped --> [*]
```

## Streaming sequence

```mermaid
sequenceDiagram
  participant U as User
  participant A as Android
  participant C as Companion
  participant X as Codex
  U->>A: Send prompt
  A->>C: Durable command
  C->>X: turn/start
  loop Batched deltas
    X-->>C: agentMessage/delta
    C-->>A: sync event batch
  end
  X-->>C: turn/completed
  C-->>A: final snapshot
  A-->>U: Final answer
```

## Wide diagram

```mermaid
flowchart TB
  A[Fresh page from server] --> B[Durable TanStack write]
  B --> C[Immutable sealed turns]
  C --> D[Live query resident window]
  D --> E[Timeline projection]
  E --> F[LegendList]
  F --> G[Stable visible history]
  B --> H[Cursor advances only after commit]
  H --> I[Next older page]
```

| Check | Expected |
| --- | --- |
| Inline | Diagram fills the bubble width |
| Fullscreen | Diagram starts centered |
| Pan/zoom | Large outer gutters leave room to drag |
| Safety | No network access from the renderer |
