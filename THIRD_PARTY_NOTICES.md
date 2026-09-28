# Third-Party Notices

August Trading is MIT-licensed (see [`LICENSE`](LICENSE)). This file records
the third-party material that ships in or with the repository, so the
provenance of the shipped artifact is inspectable. Runtime npm dependencies
are not enumerated here — they are resolved from `package.json`/`package-lock.json`
at install time and carry their own licenses.

## Bundled binaries

### Gradle Wrapper — `android/gradle/wrapper/gradle-wrapper.jar`

The Gradle wrapper JAR is committed to the repository. It is **not** covered by
this project's MIT license. It is redistributed under the Apache License 2.0 by
the Gradle project, and ships its own notice at `META-INF/LICENSE` inside the JAR.

- Project: https://gradle.org/ (Gradle, © Gradle contributors)
- License: Apache-2.0
- Why it is committed: it is the standard way to make `android/gradlew` work on
  a fresh clone. Its upstream checksum is verified by the wrapper itself at run time.

## Reference repositories studied during development

August Trading's own source code is original, with the exception of the items
credited in the next section. The projects below were **read** as architectural
references while building the debate/moderator and teammate-bots harnesses.

| Project | License | Nature of use |
|---------|---------|---------------|
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | MIT — © 2025 Nous Research | Architecture study **and** derived work, credited below |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | MIT | Architecture study — agent loop, session event log, defensive patterns |
| [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) | MIT | Architecture study — agent-loop guard and recovery patterns |

`MiniMax-AI/cli` was **not** used as a reference for this project. The word
"MiniMax" appeared in a few source comments purely as a *stylistic* reference —
"a MiniMax-style tip line", "the same intent MiniMax Code's" — describing how a
UI element should behave. No code, assets, or structure were taken from that
project. The pixel-art avatars are procedurally hand-built on a 16×20 grid
specifically so that no sprite sheets are imported (see `docs/desk/README.md`).

## Attribution — hermes-agent (MIT)

Certain modules in this repository are **derived from**
[hermes-agent](https://github.com/NousResearch/hermes-agent), Copyright (c) 2025
Nous Research, used under the MIT License. The MIT License permits this provided
the copyright notice and permission notice accompany substantial portions of the
software; this file is that notice for the following files:

- `services/agents/botMailbox.ts` — the teammate-DM contract (validate target
  against the live roster, server-side sender attribution, immediate ack with a
  later wake, per-target queueing, envelope TTL refused at drain time, hop cap)
  follows `tools/bot_mode_dm.py` in the upstream project. Rewritten for an
  in-process transport rather than the upstream socket relay.
- `components/chat/GroupChatView.tsx`, `components/chat/NewBotDialog.tsx`,
  `components/chat/NewGroupDialog.tsx`, `components/chat/BotFace.tsx` — the
  group-chat and named-bot dialog surfaces follow the upstream Bot Mode design.
  `BotFace` is a 7-shape × 10-hue geometric avatar set; it is drawn in code and
  shares no bitmap assets with upstream.
- `services/agents/groupRounds.ts`, `services/agents/agentRoster.ts`,
  `services/agents/botAttention.ts` — bounded round-robin group semantics,
  roster/handle resolution, and attention-hint classification follow the
  upstream agent-group design.
- `components/chat/ToolActionsRow.tsx`, `types/message.ts` — the
  side-effect status-row presentation and its persisted `ToolAction` shape.

The upstream project is distributed under the MIT License, reproduced at
<https://github.com/NousResearch/hermes-agent/blob/main/LICENSE>. Per-file
source comments in this repository describe behaviour only and intentionally do
not repeat the attribution; this file is the single authoritative notice.

## Copyright

Copyright (c) 2026-present August Trading contributors. Licensed under the MIT License.
