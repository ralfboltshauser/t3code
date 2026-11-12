# Context in portable handoffs

T3 Code transfers conversation context when you switch providers, continue through a portable
restart, or use a fork that the provider cannot resume itself.

Short conversations transfer intact. For longer conversations, T3 Code favors recent requests and
answers, the original request, and relevant activity such as command outcomes. Selected messages
keep their full text, order, and user or assistant role, including partial work from failed or
interrupted turns. Your new request stays separate and is never shortened to make history fit.

Codex receives historical messages directly when its installed version supports that operation.
Other providers receive the same selection as attributed conversation context. A handoff does not
copy the outgoing provider's reasoning, tool-call state, or attachments.

The handoff includes references to omitted history. The agent can use T3 Code's thread-reading tool
to retrieve saved messages and activity, including the remainder of a long item. For an important
constraint, you can still repeat it in your next message. A handoff is a budgeted selection, not an
agent-written summary.

## Continue on another machine

Use `/move` in an idle independent chat, or choose **Move chat…** from its menu or
command palette. Select a linked machine with the same repository registered. Both
servers need support for moving chats. An optional next instruction is sent there;
leaving it blank moves the chat without starting an agent turn.

The move copies recent user and assistant text, unpushed commits, and captured Git
working files into a new worktree. It uses the destination’s provider credentials
and normal worktree setup. Ignored untracked files, chat attachments, live processes,
and native provider sessions stay behind; staging is not preserved. Finish background
work, disable chat schedules and PR watches, and stop external file writers first.
Submodules, nested repositories, Git operations in progress, and bundles over 50 MiB
are refused.

The source stays readable and links to the destination. Once submitted, closing the
view does not cancel the move. If confirmation is lost, it stays paused: **Check again**
resumes the same move. A confirmed refusal lets you work here and retry. If interrupted
workspace preparation needs attention, its files are retained on the destination;
do not start a second copy until that move is resolved. To move back, use `/move` in
the destination chat; this creates another fresh worktree and keeps the earlier copies
as history. Your client may need to connect to the destination before opening it.

Newly moved worktrees are disposable. After their next confirmed move, T3 immediately
removes an exclusive source checkout and its operation-owned branch when it can
verify that the destination preserves the captured work. This runs even with age
cleanup disabled. Stop external editors, shells, builds, and other file writers
before moving; automatic retirement assumes exclusive use by this T3 environment.

The source reports whether cleanup completed or why files were kept. Project roots,
older workspaces, shared workspaces, subdirectory bindings, staged work, ignored
files (including dependency installs), sparse indexes, and changed or unsupported
files stay on the source. Unreferenced Git recovery history and unknown local Git
files also keep the source. They are preserved data, not disposable cache. Resolve
the reported condition and run Storage cleanup again, or preserve the local work
before explicitly removing a retained checkout with Git. Committing new source
work after a move does not transfer it to the destination.

The destination retains the exact incoming Git version before setup or an agent
can change it. **Copy recovery command** copies a command to create a separate
checkout of that version; run it from the destination project's repository. It
does not reset your current files. Recovery versions remain after onward moves
and thread deletion. They share Git objects but still consume storage; at 256
incoming versions in one repository, further imports stop until you deliberately
review and discard old recovery refs. T3 never expires unique incoming versions
to make room. Compact retry receipts remain so an old request cannot restart work.

This preserves supported Git file bytes, symlink text, and executable modes under
normal crash/retry recovery with retained server state. It is a transfer lifecycle,
not an independent backup against disk loss, restored old databases, uncooperative
writers, or filesystem metadata that Git does not carry. Keep backups for those
cases. Older servers can still transfer chats, but their acceptance does not
authorize automatic source retirement.

## Context limits

A handoff must leave room for existing provider context, your request and attachments, instructions,
tools, and subsequent work. If the target conversation has no room for the handoff, T3 Code starts
a fresh provider conversation with a bounded selection of saved history and sends your request
automatically. You do not need to compact manually. If the request and attachments leave too little
room even in a fresh conversation, shorten the request or select a larger-context model. T3 Code
never shortens your request to make it fit.

Recovery leaves running background work intact. Let it finish or stop it before retrying the handoff.

Server operators can set `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP` to change the initial history allowance
(default 16,000; clamped to 1,024–64,000). This is an upper bound, not a provider context-window
guarantee. Text accounting conservatively charges one token per UTF-8 byte, including attribution
and JSON escaping. Imported history has a separate 64,000-byte ceiling; your current input and
attachment payloads do not consume that ceiling.

T3 Code uses available capacity information for your selected model and options, together with
provider context telemetry. Starting a fresh provider conversation clears prior usage, while keeping
known model capacity. Changing models or context-window options discards stale usage and compaction
thresholds.

When no capacity information is available, T3 Code assumes a 128,000-token window. It reserves at
least 16,000 tokens, or a quarter of the window when larger, for instructions, tools, and subsequent
work. Images reserve an estimated 8,192 tokens each, independent of their file size; other
attachments reserve 4,096 each for their references. Existing context is estimated from saved
activity when usage telemetry is unavailable. Known smaller windows still constrain the handoff.
These are fallback estimates, not exact token counts. Image resolution, custom models, and hidden
native context can differ, so the provider may still reject an input.
