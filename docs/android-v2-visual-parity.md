# Android V2 visual parity matrix

V1 is the visual authority. A row is complete only when V1 and V2 are captured on the same Android emulator with the same data, viewport, system insets, keyboard and interaction state, and the resulting image diff has no visible discrepancy. Existing tests do not override the V1 rendering.

Every row below is atomic: one concrete visual state and one paired capture. A row that says “and similar”, combines multiple states, or lacks its own V1/V2 screenshots and diff is not complete.

Status values: `open` means not captured, `diff` means paired evidence exists but still differs, and `pass` means the pair has no visible discrepancy.

## Current coverage audit — 2026-09-01

The current authoritative run is
`test-results/android-e2e/2026-09-01T11-57-12-890Z-5ea87859/visual-parity`.
It contains five paired wide-layout states: selected thread, thread filters, thread-list menu,
context usage and composer menu. Sergey accepted their remaining small visual differences for the
current release, but they stay marked `diff` because the matrix status records measured evidence,
not release acceptance.

Of 265 atomic rows, 35 are visible inside those five paired states and 230 remain `open`. There is
no current authoritative paired evidence for phone or foldable layouts, boot/reconnect/error
states, server-selector variants, most thread and conversation states, queue and voice states, or
any of the 57 resource and secondary-route rows. Older local phone screenshots are exploratory and
do not count because their V1 and V2 data projections were not identical and no image diff was
recorded.

### Boot and application shell

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| BOOT-01 | Cold process launch before fonts are ready | Cold process launch before fonts are ready | phone, wide | — | open |
| BOOT-02 | Font bootstrap activity | Font bootstrap activity | phone, wide | — | open |
| BOOT-03 | Initial local projection loading | Initial local projection loading | phone, wide | — | open |
| BOOT-04 | Retained projection while connection starts | Retained projection while connection starts | phone, wide | — | open |
| BOOT-05 | Reconnect after socket loss | Reconnect after socket loss | phone, wide | — | open |
| BOOT-06 | Fatal startup error | Fatal startup error | phone, wide | — | open |
| BOOT-07 | Process-death restoration | Process-death restoration | phone, wide | — | open |
| BOOT-08 | Resume after backgrounding | Resume after backgrounding | phone, wide | — | open |

### Server scope and navigation

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| NAV-01 | Zero servers: thread-list shell, no standalone picker | Zero servers: thread-list shell, no standalone picker | phone | — | open |
| NAV-02 | Zero servers: rail, sidebar and empty content | Zero servers: rail, sidebar and empty content | wide | — | open |
| NAV-03 | All servers selected with empty catalog | All servers selected with empty catalog | phone, wide | — | open |
| NAV-04 | All servers selected with populated catalog | All servers selected with populated catalog | phone, wide | — | open |
| NAV-05 | One server selected with empty catalog | One server selected with empty catalog | phone, wide | — | open |
| NAV-06 | One server selected with populated catalog | One server selected with populated catalog | phone, wide | — | open |
| NAV-07 | Narrow title selector closed | Narrow title selector closed | phone, folded | — | open |
| NAV-08 | Narrow server selector sheet open | Narrow server selector sheet open | phone, folded | — | open |
| NAV-09 | Selector “All servers” row selected | Selector “All servers” row selected | phone, folded | — | open |
| NAV-10 | Selector saved-server row selected | Selector saved-server row selected | phone, folded | — | open |
| NAV-11 | Selector live server row | Selector live server row | phone, folded | — | open |
| NAV-12 | Selector connecting server row | Selector connecting server row | phone, folded | — | open |
| NAV-13 | Selector updating server row | Selector updating server row | phone, folded | — | open |
| NAV-14 | Selector offline server row | Selector offline server row | phone, folded | — | open |
| NAV-15 | Selector access-required server row | Selector access-required server row | phone, folded | — | open |
| NAV-16 | Selector connection-error server row | Selector connection-error server row | phone, folded | — | open |
| NAV-17 | Selector disabled server row | Selector disabled server row | phone, folded | — | open |
| NAV-18 | Selector Add server action | Selector Add server action | phone, folded | — | open |
| NAV-19 | Selector Settings action | Selector Settings action | phone, folded | — | open |
| NAV-20 | Selector scrim and dismiss interaction | Selector scrim and dismiss interaction | phone, folded | — | open |
| RAIL-01 | Rail with one live server | Rail with one live server | wide, unfolded | — | open |
| RAIL-02 | Rail selected marker | Rail selected marker | wide, unfolded | current wide pair | diff |
| RAIL-03 | Rail connecting spinner | Rail connecting spinner | wide, unfolded | — | open |
| RAIL-04 | Rail updating spinner | Rail updating spinner | wide, unfolded | — | open |
| RAIL-05 | Rail offline server | Rail offline server | wide, unfolded | — | open |
| RAIL-06 | Rail connection-error server | Rail connection-error server | wide, unfolded | — | open |
| RAIL-07 | Rail multiple servers and scroll | Rail multiple servers and scroll | wide, unfolded | — | open |
| RAIL-08 | Rail Add server action | Rail Add server action | wide, unfolded | — | open |
| RAIL-09 | Rail Settings action | Rail Settings action | wide, unfolded | — | open |

### Thread sidebar, search, filters and rows

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| LIST-01 | Selected-server header live | Selected-server header live | phone, wide | current wide pair | diff |
| LIST-02 | Selected-server header connecting | Selected-server header connecting | phone, wide | — | open |
| LIST-03 | All-servers header and count | All-servers header and count | phone, wide | — | open |
| LIST-04 | New thread action | New thread action | phone, wide | current wide pair | diff |
| LIST-05 | Thread-list overflow closed | Thread-list overflow closed | phone, wide | current wide pair | diff |
| LIST-06 | Thread-list account/archived popover open | Thread-list account/archived popover open | phone, wide | current wide menu pair | diff |
| LIST-07 | Search empty and unfocused | Search empty and unfocused | phone, wide | — | open |
| LIST-08 | Search focused with keyboard | Search focused with keyboard | phone, folded | — | open |
| LIST-09 | Search populated with matches | Search populated with matches | phone, wide | current wide pair | diff |
| LIST-10 | Search populated with no matches | Search populated with no matches | phone, wide | — | open |
| LIST-11 | Search voice idle | Search voice idle | phone, wide | current wide pair | diff |
| LIST-12 | Search voice starting | Search voice starting | phone, wide | — | open |
| LIST-13 | Search voice recording | Search voice recording | phone, wide | — | open |
| LIST-14 | Search voice finishing | Search voice finishing | phone, wide | — | open |
| LIST-15 | Search voice retry/error | Search voice retry/error | phone, wide | — | open |
| FILTER-01 | Filter menu open with All selected | Filter menu open with All selected | phone, wide | current wide filter pair | diff |
| FILTER-02 | Running filter selected | Running filter selected | phone, wide | — | open |
| FILTER-03 | Approval needed filter selected | Approval needed filter selected | phone, wide | — | open |
| FILTER-04 | Unread filter selected | Unread filter selected | phone, wide | — | open |
| FILTER-05 | Pinned filter selected | Pinned filter selected | phone, wide | — | open |
| FILTER-06 | Active-filter indicator dot | Active-filter indicator dot | phone, wide | — | open |
| LIST-16 | Pinned section header and rows | Pinned section header and rows | phone, wide | — | open |
| LIST-17 | Recent section header and rows | Recent section header and rows | phone, wide | current wide pair | diff |
| LIST-18 | Archived mode populated | Archived mode populated | phone, wide | — | open |
| LIST-19 | Archived mode empty | Archived mode empty | phone, wide | — | open |
| LIST-20 | Archived search populated | Archived search populated | phone, wide | — | open |
| LIST-21 | Catalog loading-more indicator | Catalog loading-more indicator | phone, wide | — | open |
| ROW-01 | Idle thread row | Idle thread row | phone, wide | current wide pair | diff |
| ROW-02 | Running thread row | Running thread row | phone, wide | — | open |
| ROW-03 | Approval-needed thread row | Approval-needed thread row | phone, wide | — | open |
| ROW-04 | Waiting-for-input thread row | Waiting-for-input thread row | phone, wide | — | open |
| ROW-05 | Failed thread row | Failed thread row | phone, wide | — | open |
| ROW-06 | Unread thread row | Unread thread row | phone, wide | — | open |
| ROW-07 | Selected thread row | Selected thread row | phone, wide | current wide pair | diff |
| ROW-08 | Pressed thread row | Pressed thread row | phone, wide | — | open |
| ROW-09 | Retained thread row | Retained thread row | phone, wide | — | open |
| ROW-10 | Thread long-press menu | Thread long-press menu | phone, wide | — | open |
| ROW-11 | Thread swipe-left actions | Thread swipe-left actions | phone | — | open |
| ROW-12 | Thread swipe-right actions | Thread swipe-right actions | phone | — | open |

### Conversation shell, header and search

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| CHAT-01 | Conversation opening/loading | Conversation opening/loading | phone, wide | — | open |
| CHAT-02 | Conversation retained projection | Conversation retained projection | phone, wide | — | open |
| CHAT-03 | Conversation reconnecting | Conversation reconnecting | phone, wide | — | open |
| CHAT-04 | Conversation live | Conversation live | phone, wide | current wide pair | diff |
| CHAT-05 | Missing/deleted thread error | Missing/deleted thread error | phone, wide | — | open |
| HEADER-01 | Wide header without Back | Wide header without Back | wide, unfolded | current wide pair | diff |
| HEADER-02 | Narrow header with Back | Narrow header with Back | phone, folded | — | open |
| HEADER-03 | Header title and server/workspace subtitle | Header title and server/workspace subtitle | phone, wide | current wide pair | diff |
| HEADER-04 | Header backend refresh indicator | Header backend refresh indicator | phone, wide | — | open |
| HEADER-05 | Header search action default | Header search action default | phone, wide | current wide pair | diff |
| HEADER-06 | Header search action active | Header search action active | phone, wide | — | open |
| HEADER-07 | Header context ring | Header context ring | phone, wide | current wide pair | diff |
| HEADER-08 | Context/account popover open | Context/account popover open | phone, wide | current wide context pair | diff |
| HEADER-09 | Thread overflow menu closed | Thread overflow menu closed | phone, wide | current wide pair | diff |
| HEADER-10 | Thread overflow menu open | Thread overflow menu open | phone, wide | — | open |
| SEARCH-01 | Conversation search empty | Conversation search empty | phone, wide | — | open |
| SEARCH-02 | Conversation search with matches | Conversation search with matches | phone, wide | — | open |
| SEARCH-03 | Conversation search with no matches | Conversation search with no matches | phone, wide | — | open |
| SEARCH-04 | Conversation search previous result | Conversation search previous result | phone, wide | — | open |
| SEARCH-05 | Conversation search next result | Conversation search next result | phone, wide | — | open |
| SEARCH-06 | Conversation search close | Conversation search close | phone, wide | — | open |
| EMPTY-01 | Existing thread with no turns | Existing thread with no turns | phone, wide | — | open |
| EMPTY-02 | New-thread project prompt | New-thread project prompt | phone, wide | — | open |
| EMPTY-03 | New-thread workspace prompt | New-thread workspace prompt | phone, wide | — | open |

### Timeline, activity and turn state

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| MSG-01 | User text bubble | User text bubble | phone, wide | current wide pair | diff |
| MSG-02 | Assistant Markdown bubble | Assistant Markdown bubble | phone, wide | current wide pair | diff |
| MSG-03 | Narrow message wrapping | Narrow message wrapping | phone, folded | — | open |
| MSG-04 | Wide message wrapping | Wide message wrapping | wide, unfolded | current wide pair | diff |
| MSG-05 | Markdown heading/list/quote | Markdown heading/list/quote | phone, wide | — | open |
| MSG-06 | Markdown table | Markdown table | phone, wide | — | open |
| MSG-07 | Code block | Code block | phone, wide | — | open |
| MSG-08 | Full-width copied text snippet | Full-width copied text snippet | phone, wide | — | open |
| MSG-09 | Inline image | Inline image | phone, wide | — | open |
| MSG-10 | Link | Link | phone, wide | — | open |
| MSG-11 | Message action rail default | Message action rail default | phone, wide | current wide pair | diff |
| MSG-12 | Message action rail open | Message action rail open | phone, wide | — | open |
| LIFE-01 | Pre-turn lifecycle row | Pre-turn lifecycle row | phone, wide | — | open |
| LIFE-02 | Reasoning activity collapsed | Reasoning activity collapsed | phone, wide | — | open |
| LIFE-03 | Reasoning activity expanded | Reasoning activity expanded | phone, wide | — | open |
| LIFE-04 | Tool activity collapsed | Tool activity collapsed | phone, wide | — | open |
| LIFE-05 | Tool activity expanded | Tool activity expanded | phone, wide | — | open |
| LIFE-06 | Command activity running | Command activity running | phone, wide | — | open |
| LIFE-07 | Command activity completed | Command activity completed | phone, wide | — | open |
| LIFE-08 | Command activity failed | Command activity failed | phone, wide | — | open |
| LIFE-09 | Plan activity | Plan activity | phone, wide | — | open |
| LIFE-10 | File-change activity | File-change activity | phone, wide | — | open |
| LIFE-11 | Attachment activity | Attachment activity | phone, wide | — | open |
| TURN-01 | Queued turn footer | Queued turn footer | phone, wide | — | open |
| TURN-02 | Running turn footer and spinner | Running turn footer and spinner | phone, wide | — | open |
| TURN-03 | Completed turn footer without usage | Completed turn footer without usage | phone, wide | current wide pair | diff |
| TURN-04 | Completed turn footer with token usage | Completed turn footer with token usage | phone, wide | current wide pair | diff |
| TURN-05 | Completed turn cost trigger | Completed turn cost trigger | phone, wide | current wide pair | diff |
| TURN-06 | Turn cost breakdown popover | Turn cost breakdown popover | phone, wide | — | open |
| TURN-07 | Failed turn footer | Failed turn footer | phone, wide | — | open |
| TURN-08 | Interrupted turn footer | Interrupted turn footer | phone, wide | — | open |
| REQ-01 | Single approval request | Single approval request | phone, wide | — | open |
| REQ-02 | Multiple approval request count | Multiple approval request count | phone, wide | — | open |
| REQ-03 | User-question request | User-question request | phone, wide | — | open |
| REQ-04 | Elicitation form request | Elicitation form request | phone, wide | — | open |
| PAGE-01 | Loading older turns | Loading older turns | phone, wide | — | open |
| PAGE-02 | Older-page boundary | Older-page boundary | phone, wide | — | open |
| PAGE-03 | Loading newer turns | Loading newer turns | phone, wide | — | open |
| PAGE-04 | Jump-to-latest action | Jump-to-latest action | phone, wide | — | open |
| PAGE-05 | Unread/new-message badge | Unread/new-message badge | phone, wide | — | open |

### Composer, queue and voice

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| CTX-01 | Model/thinking chip | Model/thinking chip | phone, wide | current wide pair | diff |
| CTX-02 | Personality chip | Personality chip | phone, wide | — | open |
| CTX-03 | Permissions chip | Permissions chip | phone, wide | current wide pair | diff |
| CTX-04 | Changes chip empty | Changes chip empty | phone, wide | current wide pair | diff |
| CTX-05 | Changes chip populated | Changes chip populated | phone, wide | — | open |
| CTX-06 | Attachments chip empty | Attachments chip empty | phone, wide | current wide pair | diff |
| CTX-07 | Attachments chip populated | Attachments chip populated | phone, wide | — | open |
| CTX-08 | Ports chip | Ports chip | phone, wide | current wide pair | diff |
| CTX-09 | Terminals chip | Terminals chip | phone, wide | — | open |
| CTX-10 | Subagents chip | Subagents chip | phone, wide | — | open |
| CTX-11 | Context strip horizontal scroll/clipping | Context strip horizontal scroll/clipping | phone, wide | current wide pair | diff |
| INPUT-01 | Empty composer | Empty composer | phone, wide | current wide pair | diff |
| INPUT-02 | Composer with one line | Composer with one line | phone, wide | — | open |
| INPUT-03 | Multiline composer | Multiline composer | phone, wide | — | open |
| INPUT-04 | Composer focused with keyboard | Composer focused with keyboard | phone, folded | — | open |
| INPUT-05 | Composer disabled while connecting | Composer disabled while connecting | phone, wide | — | open |
| INPUT-06 | Send enabled | Send enabled | phone, wide | — | open |
| INPUT-07 | Send pending/busy | Send pending/busy | phone, wide | — | open |
| INPUT-08 | Stop response action | Stop response action | phone, wide | — | open |
| INPUT-09 | Composer inline error | Composer inline error | phone, wide | — | open |
| MENU-01 | Composer menu open | Composer menu open | phone, wide | current wide menu pair | diff |
| MENU-02 | Attach file action | Attach file action | phone, wide | — | open |
| MENU-03 | Drawing action | Drawing action | phone, wide | — | open |
| MENU-04 | Terminal action | Terminal action | phone, wide | — | open |
| MENU-05 | Port forward action | Port forward action | phone, wide | — | open |
| MENU-06 | Skills action | Skills action | phone, wide | — | open |
| MENU-07 | Goal action | Goal action | phone, wide | — | open |
| MENU-08 | Disabled composer-menu action | Disabled composer-menu action | phone, wide | — | open |
| DRAFT-01 | Attachment upload pending card | Attachment upload pending card | phone, wide | — | open |
| DRAFT-02 | Image attachment card | Image attachment card | phone, wide | — | open |
| DRAFT-03 | File attachment card | File attachment card | phone, wide | — | open |
| DRAFT-04 | Remove attachment action | Remove attachment action | phone, wide | — | open |
| DRAFT-05 | Edit attachment action | Edit attachment action | phone, wide | — | open |
| DRAFT-06 | Failed attachment upload | Failed attachment upload | phone, wide | — | open |
| DRAFT-07 | Large-paste file attachment | Large-paste file attachment | phone, wide | — | open |
| QUEUE-01 | Inline queued message | Inline queued message | phone, wide | — | open |
| QUEUE-02 | Queue sheet open | Queue sheet open | phone, wide | — | open |
| QUEUE-03 | Queue item edit | Queue item edit | phone, wide | — | open |
| QUEUE-04 | Queue item delete confirmation | Queue item delete confirmation | phone, wide | — | open |
| QUEUE-05 | Queue reorder | Queue reorder | phone, wide | — | open |
| QUEUE-06 | Queue steer action | Queue steer action | phone, wide | — | open |
| QUEUE-07 | Queue uncertain state | Queue uncertain state | phone, wide | — | open |
| QUEUE-08 | Queue failed state | Queue failed state | phone, wide | — | open |
| VOICE-01 | Idle microphone | Idle microphone | phone, wide | current wide pair | diff |
| VOICE-02 | Voice starting | Voice starting | phone, wide | — | open |
| VOICE-03 | Voice recording | Voice recording | phone, wide | — | open |
| VOICE-04 | Voice finishing | Voice finishing | phone, wide | — | open |
| VOICE-05 | Voice retry | Voice retry | phone, wide | — | open |
| VOICE-06 | Voice error | Voice error | phone, wide | — | open |
| VOICE-07 | Voice cancellation | Voice cancellation | phone, wide | — | open |
| VOICE-08 | Transcript inserted into draft | Transcript inserted into draft | phone, wide | — | open |

### Resources and secondary routes

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| ATT-01 | Attachments loading | Attachments loading | phone, wide | — | open |
| ATT-02 | Attachments empty | Attachments empty | phone, wide | — | open |
| ATT-03 | Attachments list | Attachments list | phone, wide | — | open |
| ATT-04 | Attachments refresh | Attachments refresh | phone, wide | — | open |
| ATT-05 | Document preview | Document preview | phone, wide | — | open |
| ATT-06 | Image preview | Image preview | phone, wide | — | open |
| ATT-07 | Video player | Video player | phone, wide | — | open |
| ATT-08 | Attachment download/materialize | Attachment download/materialize | phone, wide | — | open |
| ATT-09 | Attachment error | Attachment error | phone, wide | — | open |
| CHG-01 | Changes loading | Changes loading | phone, wide | — | open |
| CHG-02 | Changes empty | Changes empty | phone, wide | — | open |
| CHG-03 | Changes scope selector | Changes scope selector | phone, wide | — | open |
| CHG-04 | Changed-file list | Changed-file list | phone, wide | — | open |
| CHG-05 | File diff | File diff | phone, wide | — | open |
| CHG-06 | Review controls | Review controls | phone, wide | — | open |
| CHG-07 | Changes error | Changes error | phone, wide | — | open |
| TERM-01 | Terminal loading | Terminal loading | phone, wide | — | open |
| TERM-02 | Terminal opening | Terminal opening | phone, wide | — | open |
| TERM-03 | Active terminal | Active terminal | phone, wide | — | open |
| TERM-04 | Terminal with keyboard open | Terminal with keyboard open | phone, folded | — | open |
| TERM-05 | Terminal after fold/unfold resize | Terminal after fold/unfold resize | folded, unfolded | — | open |
| TERM-06 | Terminal reconnecting | Terminal reconnecting | phone, wide | — | open |
| TERM-07 | Terminal replay loss | Terminal replay loss | phone, wide | — | open |
| TERM-08 | Terminal exited | Terminal exited | phone, wide | — | open |
| TERM-09 | Terminal error | Terminal error | phone, wide | — | open |
| PORT-01 | Ports loading | Ports loading | phone, wide | — | open |
| PORT-02 | Ports empty | Ports empty | phone, wide | — | open |
| PORT-03 | Discovered-port list | Discovered-port list | phone, wide | — | open |
| PORT-04 | Active tunnel | Active tunnel | phone, wide | — | open |
| PORT-05 | Create tunnel pending | Create tunnel pending | phone, wide | — | open |
| PORT-06 | Revoke tunnel pending | Revoke tunnel pending | phone, wide | — | open |
| PORT-07 | Tunnel expiry | Tunnel expiry | phone, wide | — | open |
| PORT-08 | Ports error | Ports error | phone, wide | — | open |
| AGENT-01 | Agents loading | Agents loading | phone, wide | — | open |
| AGENT-02 | Agents empty | Agents empty | phone, wide | — | open |
| AGENT-03 | Agent list | Agent list | phone, wide | — | open |
| AGENT-04 | Selected child conversation | Selected child conversation | phone, wide | — | open |
| AGENT-05 | Agents error | Agents error | phone, wide | — | open |
| NEW-01 | New-thread project selector | New-thread project selector | phone, wide | — | open |
| NEW-02 | New-thread workspace mode | New-thread workspace mode | phone, wide | — | open |
| NEW-03 | New-thread model/thinking/permissions controls | New-thread model/thinking/permissions controls | phone, wide | — | open |
| NEW-04 | New-thread create pending | New-thread create pending | phone, wide | — | open |
| NEW-05 | New-thread create failure | New-thread create failure | phone, wide | — | open |
| PAIR-01 | Manual pairing-link entry | Manual pairing-link entry | phone, wide | — | open |
| PAIR-02 | QR scanner permission prompt | QR scanner permission prompt | phone | — | open |
| PAIR-03 | QR scanner active | QR scanner active | phone | — | open |
| PAIR-04 | Pairing connecting/pending | Pairing connecting/pending | phone, wide | — | open |
| PAIR-05 | Invalid pairing link | Invalid pairing link | phone, wide | — | open |
| PAIR-06 | Pairing failure | Pairing failure | phone, wide | — | open |
| PAIR-07 | Pairing success and workspace reveal | Pairing success and workspace reveal | phone, wide | — | open |
| SET-01 | Settings root | Settings root | phone, wide | — | open |
| SET-02 | Saved-server settings live | Saved-server settings live | phone, wide | — | open |
| SET-03 | Saved-server disabled | Saved-server disabled | phone, wide | — | open |
| SET-04 | Saved-server reconnect pending | Saved-server reconnect pending | phone, wide | — | open |
| SET-05 | Saved-server delete confirmation | Saved-server delete confirmation | phone, wide | — | open |
| SET-06 | Saved-server settings error | Saved-server settings error | phone, wide | — | open |
| SET-07 | Account settings | Account settings | phone, wide | — | open |

### Responsive and interaction states

| ID | V1 state | V2 scenario | Targets | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| RESP-01 | Narrow phone portrait | Narrow phone portrait | phone | — | open |
| RESP-02 | Phone landscape | Phone landscape | phone landscape | — | open |
| RESP-03 | Tablet/wide three-panel layout | Tablet/wide three-panel layout | wide | current wide pairs | diff |
| RESP-04 | Folded layout | Folded layout | folded | — | open |
| RESP-05 | Unfolded layout | Unfolded layout | unfolded | — | open |
| RESP-06 | Live folded-to-unfolded resize | Live folded-to-unfolded resize | folded → unfolded | — | open |
| RESP-07 | Live unfolded-to-folded resize | Live unfolded-to-folded resize | unfolded → folded | — | open |
| RESP-08 | Keyboard closed-to-open resize | Keyboard closed → open | phone, folded | — | open |
| RESP-09 | Keyboard open-to-closed resize | Keyboard open → closed | phone, folded | — | open |
| INT-01 | Default actionable control | Matching V2 control | every surface | — | open |
| INT-02 | Pressed actionable control | Matching V2 control pressed | every surface | — | open |
| INT-03 | Selected actionable control | Matching V2 control selected | every surface | — | open |
| INT-04 | Disabled actionable control | Matching V2 control disabled | every surface | — | open |
| INT-05 | Busy/pending actionable control | Matching V2 control pending | every async action | — | open |
| INT-06 | Focused text/control state | Matching V2 focus state | every input | — | open |
| INT-07 | Modal/sheet scrim | Matching V2 scrim | every modal/sheet | — | open |
| INT-08 | Modal/sheet clipping and safe area | Matching V2 clipping and safe area | every modal/sheet | — | open |

## Evidence contract

Each completed row must link to its V1 screenshot, V2 screenshot, diff image and ADB/Appium scenario. Unit, render and source-contract tests are supporting evidence only. Any missing row, missing artifact, visible diff, placeholder, inert control, blank screen or route that uses a different composition keeps this matrix incomplete.
