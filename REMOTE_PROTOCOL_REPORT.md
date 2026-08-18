# CodeWide: протокол и возможность своего клиента

Дата: 2026-08-09  
Срез исходников: [`openai/codex@a16863f`](https://github.com/openai/codex/commit/a16863f8704831d13e041ed7dba2c4a57a2a940b)  
Проверенная локальная версия Codex: `0.147.0`

## Вердикт

Здесь есть две разные remote-системы:

1. **Codex app-server protocol** — открытый протокол, специально предназначенный для богатых сторонних клиентов. Нативное desktop/mobile-приложение может управлять установленным на другой машине Codex напрямую. Веб-клиенту нужен свой backend-gateway: браузер напрямую не подключится, потому что App Server отвергает WebSocket-запросы с заголовком `Origin`.
2. **ChatGPT Remote relay** — host-side транспорт открыт, но relay-сервис OpenAI и мобильный controller не опубликованы как компоненты или поддерживаемый сторонний API.

| Подход | Вердикт | Причина |
| --- | --- | --- |
| Свой клиент через SSH, VPN или аутентифицированный WSS к `codex app-server` | **PASS** | Публичный протокол, генерируемые схемы, полные threads/turns/events/approvals |
| Продукт поверх OpenAI ChatGPT Remote relay | **FAIL** | Controller API и relay закрыты, завязаны на ChatGPT-account и не даны как integration contract |
| Свой outbound relay и маленький host-agent поверх App Server | **CONDITIONAL** | Реализуемо, но pairing, auth, replay, E2E-шифрование и эксплуатация становятся нашей ответственностью |

Самый короткий честный прототип — прямой App Server через SSH или mesh VPN. Начинать с клонирования OpenAI relay не стоит.

## Что именно открыто

OpenAI называет открытыми CLI, SDK и App Server. IDE extension и Codex cloud закрыты; ChatGPT desktop/mobile app тоже не указан среди open-source компонентов. См. официальную страницу [Open Source](https://learn.chatgpt.com/docs/open-source).

Репозиторий лицензирован под Apache-2.0, поэтому определения протокола и клиентскую реализацию можно переиспользовать с соблюдением лицензии.

Главные части исходников:

- [`codex-rs/app-server`](openai-codex/codex-rs/app-server) — runtime App Server и обработчики RPC.
- [`codex-rs/app-server-protocol`](openai-codex/codex-rs/app-server-protocol) — Rust-типы, TypeScript и JSON Schema.
- [`codex-rs/app-server-client`](openai-codex/codex-rs/app-server-client) — рабочий Rust-клиент для WebSocket и Unix socket.
- [`remote_control`](openai-codex/codex-rs/app-server-transport/src/transport/remote_control) — открытая host-side часть ChatGPT Remote.

Нюанс платформ: публичная документация ChatGPT обещает desktop hosts на macOS/Windows. При этом экспериментальная команда `remote-control` в Codex CLI и App Server daemon уже работают на Unix; daemon пока не реализует Windows lifecycle management. На Linux Remote Control также подключается.

## Слой 1: публичный App Server

OpenAI прямо описывает App Server как интерфейс для встраивания Codex в свой продукт. Wire protocol и API опубликованы в [официальной документации App Server](https://learn.chatgpt.com/docs/app-server).

### Транспорт

Payload — JSON-RPC 2.0 без поля `"jsonrpc":"2.0"`:

- `stdio://`: один JSON-объект на строку;
- `ws://IP:PORT`: один RPC на WebSocket text frame;
- `unix://` или `unix://PATH`: WebSocket framing поверх AF_UNIX;
- `off`: без локального транспорта.

WebSocket-транспорт пока experimental. Версия `0.147.0` не запускает non-loopback listener без capability token или signed JWT. TLS сам App Server не терминирует: для публичного WSS нужен reverse proxy. Обычный `ws://` допустим только на loopback, в SSH-туннеле или внутри доверенной шифрованной mesh-сети.

### Handshake и жизненный цикл

Каждое соединение независимо и начинается так:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"my_remote_app","title":"My Remote App","version":"0.1.0"},"capabilities":{"experimentalApi":false}}}
{"method":"initialized","params":{}}
```

Дальше поток выглядит так:

```text
client                         codex app-server на remote host
  |                                      |
  | initialize / initialized             |
  |-------------------------------------> |
  | thread/list, thread/start или resume  |
  |-------------------------------------> |
  | turn/start                            |
  |-------------------------------------> |
  | <----- turn/item/delta notifications |
  | <----- approval request с id          |
  | approval response с тем же id         |
  |-------------------------------------> |
  | <------------- turn/completed         |
```

Основные сущности:

- **Thread** — персистентный разговор и рабочий контекст.
- **Turn** — одна инструкция пользователя и последующий agent run.
- **Item** — сообщения, reasoning, команды, патчи, tool calls и другие части turn.

API покрывает создание/resume/fork/list/read thread, стриминг turn, steering и interrupt, diff, процессы, файловые операции, auth/account, skills/plugins/MCP и server-initiated approvals.

Точную схему нужно генерировать из установленной версии Codex:

```sh
codex app-server generate-ts --experimental --out ./schemas
codex app-server generate-json-schema --experimental --out ./schemas
```

Схемы version-specific. Нормальный клиент должен сохранить `serverVersion` из ответа `initialize`, игнорировать неизвестные notifications и либо поддерживать матрицу совместимости, либо поставлять совместимую версию host companion.

### Approval flow

Approval — двунаправленный JSON-RPC. App Server присылает, например, `item/commandExecution/requestApproval` с `id`; клиент отвечает на тот же `id`:

```json
{"id":17,"result":{"decision":"accept"}}
```

Есть также `acceptForSession`, `decline` и `cancel`. Поэтому мобильный UI может сохранять permission gates Codex, не превращая remote-доступ в неявный full-auto.

## Слой 2: ChatGPT Remote relay

По официальной документации Remote связывает телефон и desktop host через QR-код, требует один ChatGPT account/workspace и работает с файлами, credentials, tools, plugins, permissions и browser setup хоста. См. [Remote](https://learn.chatgpt.com/docs/remote) и [Remote connections](https://learn.chatgpt.com/docs/remote-connections).

Открытая host-side реализация показывает следующий поток.

### Enrollment и pairing

1. App Server требует ChatGPT-auth; API key для Remote Control запрещён.
2. Хост регистрируется в ChatGPT с account access token, `chatgpt-account-id`, installation id, именем машины, OS, архитектурой и версией App Server.
3. Backend возвращает `server_id`, `environment_id`, короткоживущий `remote_control_token` и срок его жизни.
4. Pairing создаёт короткоживущий `pairing_code` и опционально ручной код. ChatGPT mobile claims этот код и выдаёт устройству доступ к environment.
5. Enrollment identity хранится в SQLite. Relay token намеренно не персистится и обновляется через ChatGPT-auth.

В host-коде видны production endpoints:

```text
POST /backend-api/wham/remote/control/server/enroll
POST /backend-api/wham/remote/control/server/refresh
POST /backend-api/wham/remote/control/server/pair
POST /backend-api/wham/remote/control/server/pair/status
WSS  /backend-api/wham/remote/control/server
```

Host implementation разрешает только HTTPS URL внутри `chatgpt.com`, `chatgpt-staging.com` или localhost для тестов.

### Relay-соединение

Хост открывает **исходящий** WSS, поэтому работает за NAT без inbound port. В upgrade передаются:

```text
Authorization: Bearer <short-lived remote_control_token>
x-codex-server-id: <server_id>
x-codex-name: <base64 machine name>
x-codex-protocol-version: 3
x-codex-installation-id: <installation id>
x-codex-subscribe-cursor: <optional reconnect cursor>
```

App Server JSON-RPC едет внутри routing envelope:

```json
{
  "type": "client_message",
  "client_id": "...",
  "stream_id": "...",
  "seq_id": 42,
  "cursor": "...",
  "message": {"id":1,"method":"initialize","params":{}}
}
```

Ответы хоста идут как `server_message` с теми же client/stream ids. Каждая пара `(client_id, stream_id)` становится отдельным логическим соединением App Server, а первым сообщением обязан быть `initialize`.

### Надёжность

- Host WebSocket ping каждые 10 секунд; pong timeout — 60 секунд.
- Логический remote client удаляется после 10 минут бездействия.
- Sequence ids, acknowledgements и reconnect cursor дают replay и дедупликацию.
- Не подтверждённые server messages лежат в bounded buffer и повторяются после reconnect.
- Большие RPC режутся на base64-чанки примерно по 100 KiB; envelope ограничен 150 KiB, reassembly — 100 MiB и 1024 сегментами.

### Security boundary

Открытый host-код сериализует JSON-RPC прямо в relay envelopes и отправляет их через WSS. Дополнительного controller-to-host шифрования payload в этом пути нет. TLS защищает сетевые соединения, но relay OpenAI находится внутри trust boundary и технически может обрабатывать содержимое RPC.

Remote Control — высокопривилегированный канал: он даёт доступ к conversations, файлам, командам, tools, screenshots и approval requests и запускает работу с настроенными на хосте credentials. Managed config может полностью отключить Remote; выданные controller grants можно посмотреть и отозвать.

## Может ли наше приложение использовать Remote protocol

### Через ChatGPT relay

Не как поддерживаемая интеграция. Host-половина открыта, но публичного controller API/SDK, controller-auth/grant flow и relay contract я не нашёл. Документация поддерживает только официальные ChatGPT apps. Стороннему controller пришлось бы имитировать или reverse engineer закрытый mobile client — это хрупко, account-coupled и может упереться в policy.

Даже открытый host transport помечен версией `3` и остаётся experimental. Зависимость от недокументированного controller behavior сразу создаст compatibility debt.

### Через App Server

Да. Это официальный extension seam. Мы можем реализовать тот же рабочий цикл — threads, streamed output, commands, diffs, approvals и cancellation — без ChatGPT Remote backend.

SSH-режим desktop app подтверждает архитектуру: приложение запускает удалённый Codex App Server через login shell remote user. Наш клиент может делать то же самое.

## Рекомендуемая архитектура

### Прототип: прямое соединение

```text
mobile/desktop app
      |
      | SSH tunnel или mesh VPN
      v
authenticated App Server transport
      |
      v
codex app-server на dev-машине
      |
      +-- repository и filesystem
      +-- shell и tools
      +-- локальные auth/config Codex
```

Приоритет транспорта:

1. **SSH + stdio** — лучший безопасный default, listener не нужен.
2. **Mesh VPN + authenticated WebSocket на mesh IP** либо SSH port-forward на loopback — самый простой интерактивный прототип между своими устройствами.
3. **WSS + capability token или signed JWT** — только с TLS proxy и нормальной ротацией секретов.

### Product-grade связь через NAT

Если direct networking неприемлем, нужен маленький companion на хосте:

```text
app <-- WSS + device identity --> наш relay <-- outbound WSS --> host companion <-- stdio --> app-server
```

Companion оставляет Codex на stdio/Unix socket и наружу выпускает только нужный subset методов. Наш relay-протокол должен иметь:

- одноразовый QR pairing с явным подтверждением на хосте;
- отдельные ключи устройств и revocation;
- E2E encryption, чтобы relay не видел source code и command output;
- seq/ack/reconnect cursor, bounded replay и backpressure;
- строгий approval routing без auto-approve после reconnect;
- короткоживущие credentials и аудит device/session identity;
- negotiation версии протокола и минимально допустимую версию host.

Это повторяет полезную форму OpenAI Remote, но не связывает продукт с закрытыми endpoints OpenAI.

## Первый milestone

Сначала стоит сделать тонкий read-mostly client к `codex app-server`:

1. Подключение через SSH или VPN.
2. `initialize` и отображение `serverVersion`.
3. `thread/list`, `thread/read`, `thread/resume`.
4. Старт turn и rendering streamed agent text/command output.
5. `turn/interrupt` и command/file approvals.
6. Без raw filesystem/process API в первой версии UI.

Решающая проверка: телефон завершает один реальный turn и один approval через SSH/VPN после disconnect/reconnect. Этого достаточно, чтобы проверить protocol и UX до инвестиций в relay.

## Проверка на текущей машине

Установлен `codex-cli 0.147.0`; managed App Server той же версии запущен на штатном Unix control socket. Read-only live probe успешно прошёл:

```text
WebSocket upgrade over AF_UNIX
initialize -> initialized
remoteControl/status/read -> connected
```

Сгенерированные этой же версией experimental TypeScript bindings содержат `thread/start`, `turn/start`, approval requests и `remoteControl/*`. Значит, проверенные исходники, бинарь и живой Desktop host согласованы по нужной поверхности протокола.
