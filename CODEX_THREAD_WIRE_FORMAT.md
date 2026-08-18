# Формат тредов Codex CLI / App Server

Проверено 2026-08-09 на локально установленном `codex-cli 0.147.0`, на
open-source snapshot `a16863f8704831d13e041ed7dba2c4a57a2a940b` и живом Desktop App
Server через WebSocket-over-AF_UNIX.

## Короткий вывод

Codex отдаёт историю не как единую Markdown-строку. Публичный v2 App Server
контракт имеет иерархию:

```text
Thread
└── Turn[]
    └── ThreadItem[]
        ├── userMessage
        ├── agentMessage
        ├── reasoning
        ├── commandExecution
        ├── fileChange
        ├── mcpToolCall
        ├── webSearch
        ├── imageGeneration
        └── ...
```

Markdown-подобный текст находится только внутри `agentMessage.text`, `plan.text`
и некоторых текстовых полей. Команды, патчи, web search, tool calls, изображения
и subagents уже приходят отдельными типизированными объектами. Поэтому
`ThreadItem.type` можно использовать напрямую как ключ нашего renderer registry.

Официальная документация: <https://developers.openai.com/codex/app-server>.

## Wire envelope

App Server использует JSON-RPC 2.0 без поля `"jsonrpc": "2.0"` на wire.

```json
// request
{"id": 3, "method": "thread/read", "params": {"threadId": "...", "includeTurns": true}}

// response
{"id": 3, "result": {"thread": {}}}

// notification
{"method": "item/agentMessage/delta", "params": {"threadId": "...", "turnId": "...", "itemId": "...", "delta": "..."}}
```

Транспорт не меняет JSON:

- stdio: один JSON object на строку JSONL;
- WebSocket: один JSON object на text frame;
- Unix socket: WebSocket с HTTP Upgrade поверх AF_UNIX.

После соединения обязательны `initialize` request и `initialized` notification.

## Чтение истории

### `thread/list`

Возвращает страницы summary-объектов. Поле `turns` здесь всегда пустое.

```ts
type ThreadListResponse = {
  data: Thread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};
```

В живом ответе `0.147.0` каждый `Thread` содержал поля:

```text
id, sessionId, forkedFromId, parentThreadId, preview, ephemeral,
section, sectionEnteredAt, historyMode, modelProvider, createdAt,
updatedAt, recencyAt, status, path, cwd, cliVersion, source,
canAcceptDirectInput, threadSource, agentNickname, agentRole,
gitInfo, name, turns, extra
```

`historyMode`, `canAcceptDirectInput` и `extra` появились потому, что live probe
инициализировался с `capabilities.experimentalApi = true`. В stable schema этих
полей нет.

### `thread/read`

```json
{
  "id": 3,
  "method": "thread/read",
  "params": {
    "threadId": "019...",
    "includeTurns": true
  }
}
```

Ответ:

```ts
type ThreadReadResponse = { thread: Thread };
```

`includeTurns: false` возвращает только metadata. `true` восстанавливает turns и
items из persisted rollout, но не загружает тред в память и не подписывает клиента
на live events.

### Пагинация

`thread/turns/list` — experimental, но в `0.147.0` работает:

```ts
type ThreadTurnsListParams = {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
  sortDirection?: "asc" | "desc" | null;
  itemsView?: "notLoaded" | "summary" | "full" | null;
};

type ThreadTurnsListResponse = {
  data: Turn[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};
```

`thread/items/list` присутствует в experimental schema, но live App Server
`0.147.0` вернул:

```json
{"code": -32601, "message": "thread/items/list is not supported yet"}
```

На него клиент пока не должен полагаться.

## `Thread`

Сокращённая stable форма:

```ts
type Thread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  ephemeral: boolean;
  section: { id: string; name: string } | null;
  sectionEnteredAt: number | null;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: ThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: SessionSource;
  threadSource: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: { sha: string | null; branch: string | null; originUrl: string | null } | null;
  name: string | null;
  turns: Turn[];
};

type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | {
      type: "active";
      activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput">;
    };
```

`path` помечен unstable и не должен быть частью продуктового контракта нашего
клиента.

## `Turn`

```ts
type Turn = {
  id: string;
  items: ThreadItem[];
  itemsView: "notLoaded" | "summary" | "full";
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: TurnError | null;
  startedAt: number | null;   // Unix seconds
  completedAt: number | null; // Unix seconds
  durationMs: number | null;
};
```

## Полный union `ThreadItem` в `0.147.0`

### Сообщения

```ts
type UserMessage = {
  type: "userMessage";
  id: string;
  clientId: string | null;
  content: UserInput[];
};

type AgentMessage = {
  type: "agentMessage";
  id: string;
  text: string;
  phase: "commentary" | "final_answer" | null;
  memoryCitation: MemoryCitation | null;
};

type UserInput =
  | { type: "text"; text: string; text_elements: TextElement[] }
  | { type: "image"; url: string; detail?: ImageDetail }
  | { type: "localImage"; path: string; detail?: ImageDetail }
  | { type: "audio"; url: string }
  | { type: "localAudio"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };
```

Важно: `text_elements` действительно snake_case и в generated TypeScript, и в
живом wire payload. Нельзя автоматически предполагать camelCase для каждого
вложенного типа.

### План и reasoning

```ts
type PlanItem = {
  type: "plan";
  id: string;
  text: string;
};

type ReasoningItem = {
  type: "reasoning";
  id: string;
  summary: string[];
  content: string[];
};
```

`summary` предназначен для отображаемого reasoning summary. Наличие raw
`content` зависит от режима и политики; клиент не должен ожидать, что оно будет
заполнено.

### Выполнение команд

```ts
type CommandExecution = {
  type: "commandExecution";
  id: string;
  pluginId: string | null;
  scriptPath: string | null;
  command: string;
  cwd: string;
  processId: string | null;
  source: "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";
  status: "inProgress" | "completed" | "failed" | "declined";
  commandActions: CommandAction[];
  aggregatedOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
};
```

Во время выполнения output приходит отдельными
`item/commandExecution/outputDelta`, а завершённый item содержит
`aggregatedOutput`.

### Изменения файлов

```ts
type FileChange = {
  type: "fileChange";
  id: string;
  changes: Array<{
    path: string;
    kind:
      | { type: "add" }
      | { type: "delete" }
      | { type: "update"; move_path: string | null };
    diff: string;
  }>;
  status: "inProgress" | "completed" | "failed" | "declined";
};
```

Патч может обновляться через `item/fileChange/patchUpdated`. Deprecated
`item/fileChange/outputDelta` больше не является источником истины.

### MCP и custom tools

```ts
type McpToolCall = {
  type: "mcpToolCall";
  id: string;
  server: string;
  tool: string;
  status: McpToolCallStatus;
  arguments: unknown;
  appContext: {
    connectorId: string;
    linkId: string | null;
    resourceUri: string | null;
    appName: string | null;
    actionName: string | null;
  } | null;
  pluginId: string | null;
  readOnlyHint: boolean | null;
  result: {
    content: unknown[];
    structuredContent: unknown | null;
    _meta: unknown | null;
  } | null;
  error: McpToolCallError | null;
  durationMs: number | null;
};

type DynamicToolCall = {
  type: "dynamicToolCall";
  id: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
  status: DynamicToolCallStatus;
  contentItems: Array<
    | { type: "inputText"; text: string }
    | { type: "inputImage"; imageUrl: string }
    | { type: "inputAudio"; audioUrl: string }
  > | null;
  success: boolean | null;
  durationMs: number | null;
};
```

`mcpToolCall.result.structuredContent`, `_meta` и
`appContext.resourceUri` — естественная точка расширения rich renderer. Это
opaque JSON, поэтому его надо валидировать своей versioned schema до рендера.
`resourceUri` потенциально требует отдельного sandboxed HTML/App renderer, а не
обычного Markdown renderer.

### Остальные типы

```text
hookPrompt
collabAgentToolCall
subAgentActivity
webSearch
imageView
sleep
imageGeneration
enteredReviewMode
exitedReviewMode
contextCompaction
```

`webSearch.results` специально объявлен как `unknown[]`: новые типы и поля
результатов могут проходить через App Server без обновления Codex. В живом
payload наблюдались элементы `type: "text_result"` с `domain`, `ref_id`,
`snippet`, `title`, `url`.

## Live streaming lifecycle

Нормальная последовательность:

```text
turn/started
item/started                         full initial ThreadItem
item/.../delta or item/.../updated   zero or more patches
item/completed                       authoritative final ThreadItem
turn/completed                       authoritative final Turn
```

Базовые notification payloads:

```ts
type ItemStartedNotification = {
  threadId: string;
  turnId: string;
  item: ThreadItem;
  startedAtMs: number;
};

type AgentMessageDeltaNotification = {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
};

type ItemCompletedNotification = {
  threadId: string;
  turnId: string;
  item: ThreadItem;
  completedAtMs: number;
};
```

Клиентская модель должна индексировать item по тройке
`(threadId, turnId, item.id)`. Deltas нужны для анимации; итоговый
`item/completed.item` заменяет накопленное состояние целиком.

## Что показал живой тред

Read-only probe текущего треда через `thread/read(includeTurns=true)` вернул:

```text
source: vscode
cliVersion: 0.147.0
turns: 6
turn statuses: completed=5, inProgress=1

items:
  userMessage       6
  agentMessage      14
  webSearch         19
  reasoning         20
  fileChange        6
  contextCompaction 1
```

Содержимое сообщений, пути и идентификаторы в probe были редактированы; снимались
только типы, ключи, enum-значения и размеры строк.

Особенно показателен реальный `fileChange`:

```json
{
  "type": "fileChange",
  "id": "<id>",
  "changes": [
    {
      "path": "<redacted>",
      "kind": {"type": "add"},
      "diff": "<redacted>"
    }
  ],
  "status": "completed"
}
```

Это уже готовый отдельный UI block, а не fenced code внутри Markdown.

## Persisted JSONL не равен App Server view

На диске тред хранится как rollout JSONL. В текущем треде встретились envelopes:

```text
session_meta
turn_context
event_msg
response_item
world_state
compacted
```

Например, в raw rollout были `response_item` типов `message`, `reasoning`,
`custom_tool_call`, `custom_tool_call_output`, а `event_msg` типов
`user_message`, `agent_message`, `web_search_end`, `patch_apply_end`,
`task_started`, `task_complete` и другие.

`thread/read` преобразует этот внутренний event log в стабильнее устроенную
модель `Thread/Turn/ThreadItem` и не обязан возвращать каждый raw event. Для
нашего приложения нельзя напрямую парсить rollout JSONL: это storage format, не
клиентский protocol contract.

## Практический renderer contract

Для клиента разумна такая граница:

```ts
type RenderableItem = ThreadItem | UnknownThreadItem;

type UnknownThreadItem = {
  type: string;
  [key: string]: unknown;
};

const renderers = {
  userMessage: UserMessageBlock,
  agentMessage: AgentMessageBlock,
  reasoning: ReasoningBlock,
  commandExecution: CommandExecutionBlock,
  fileChange: DiffBlock,
  mcpToolCall: McpToolCallBlock,
  dynamicToolCall: DynamicToolCallBlock,
  webSearch: WebSearchBlock,
  imageGeneration: ImageGenerationBlock,
};
```

Правила совместимости:

1. Пиновать поддерживаемый диапазон Codex CLI и проверять `cliVersion`.
2. Генерировать TypeScript schema именно из поддерживаемого binary.
3. Иметь safe fallback для неизвестного `ThreadItem.type`.
4. Не рендерить opaque `structuredContent`, `_meta` или web search results без
   runtime validation.
5. Не зависеть от `path` и экспериментального `thread/items/list`.
6. Считать `item/completed` и `turn/completed` authoritative state.

## Сгенерированные артефакты

Из установленного `codex-cli 0.147.0` сгенерированы обе версии контрактов:

```sh
codex app-server generate-ts --out codex-schema-0.147.0/typescript
codex app-server generate-json-schema --out codex-schema-0.147.0/json

codex app-server generate-ts --experimental \
  --out codex-schema-0.147.0/typescript-experimental
codex app-server generate-json-schema --experimental \
  --out codex-schema-0.147.0/json-experimental
```

Это 2011 generated files, около 14 MiB. Ключевые файлы:

```text
codex-schema-0.147.0/typescript/v2/Thread.ts
codex-schema-0.147.0/typescript/v2/Turn.ts
codex-schema-0.147.0/typescript/v2/ThreadItem.ts
codex-schema-0.147.0/typescript/ServerNotification.ts
codex-schema-0.147.0/json/codex_app_server_protocol.schemas.json
```

`inspect_live_thread.py` повторяет read-only live probe и выводит только
редактированную структуру без текста сообщений, путей и идентификаторов.
