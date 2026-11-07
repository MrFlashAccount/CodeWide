# Third-party fixtures

The `*.ndjson` files in this directory are Claude Agent SDK replay transcripts
copied unchanged from t3code (https://github.com/pingdotgg/t3code), commit
`101f8b2f55df50d4f8d70ed8e6b8e0edf71a2f31`, path
`apps/server/src/orchestration-v2/testkit/fixtures/<scenario>/claude_transcript.ndjson`.
They are used under the MIT License reproduced below. They have since been
modified: the session-state protocol frames the CLI writes under
`CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS` and `--replay-user-messages`
(`system/session_state_changed`, and `command_lifecycle` where the recording
had none) were added at the points the recording implies (see "Session-state
conversion" below), and the `*_no_echo` variants, which recorded an SDK that
wrote no `command_lifecycle`, were removed.

MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## CodeWide synthetic transcripts

`codewide_*.ndjson` are CodeWide's own transcripts in the same format. They
were written by hand after the shapes observed in live Agent SDK 0.3.295 runs
(the `_sdk-probe` B2/B3/B4 recordings) and contain no recorded user data.

## Session-state conversion

The recordings above predate the session-state protocol. Their protocol frames
were added once, mechanically: `running` before the first frame of a busy
period (after the prompt that starts it, or before a wake's first frame);
`idle` after a result that Claude did not follow with more of its own output
(after that result's trailing `command_lifecycle` frames); for a recording
without `command_lifecycle`, `queued` and `started` for a prompt offered while
Claude was idle, `queued` for a steer, `cancelled` for the steered message and
`started` for the steer at the steer's `aborted_*` result, and `completed` at
the next result otherwise. A process exit starts the next query idle. No
recording offers a non-steer prompt while Claude works, where the conversion
would have had to guess. `codewide_lost_session.ndjson` was converted by hand:
the replacement process takes the resent prompt.

`codewide_state_*.ndjson` are CodeWide's own recordings of the session-state
protocol from a live Claude Code 2.1.310 (`claude --model haiku`), with the
working directory, home directory, temporary and socket paths replaced by
neutral ones. They contain no user data.
