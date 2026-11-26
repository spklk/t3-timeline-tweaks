# t3-timeline-tweaks

An unofficial local patch for the [T3 Code](https://github.com/pingdotgg/t3code) desktop app.
It makes the agent's thinking readable, keeps it expanded, and makes it obvious when the agent is
still working.

What it changes:

- work groups (tool/thinking runs) start expanded
- finished turns stay expanded under a clickable "Worked for Xs" header; one click folds the turn away,
  and reopening it brings back the rows you had open
- "Thought" rows start expanded
- command and tool rows start expanded, so their output shows without a click; long output still
  scrolls inside T3's own height cap
- subagent groups start expanded
- clicking still collapses (or opens) any of these, and that choice sticks when the row scrolls away
- thinking text is muted (`text-secondary-label`) and smaller than replies (`text-xs`, 12px vs 14px), with a
  thin line down its left edge; `T3_THOUGHTS` changes this (see below)
- the "Working for Xs" timer sits at the bottom of the timeline while the agent works, instead of
  under your message where expanded output scrolls it out of view; it shimmers like "Thinking" and
  uses small italic text in the thinking color so it reads as a status line; its text is the muted
  icon grey (like the brain icon) so the white shimmer band stands out
- the thinking panel's 384px max-height cap and its own scroll container are removed (no inner scrollbar)
- the tool-call group is no longer capped at min(18rem, 50dvh); it grows with its content instead of scrolling
- an approval prompt shows the whole command it asks about instead of scrolling it after 10 lines
- optional tool-row styling with `T3_TOOLS` (see below): smaller titles, a box around expanded details,
  and shorter titles (no leading `cd <dir> &&`, home directory as `~`)

Upstream discussion: https://github.com/pingdotgg/t3code/discussions/12149

## Install

The easiest way: point your coding agent (Copilot, Claude Code, Codex, ...) at this repo and ask it to
**"install t3-timeline-tweaks following AGENTS.md"**. [AGENTS.md](AGENTS.md) walks it through
detection, applying, keeping the patch applied after T3 updates on macOS, Windows and Linux, and fixing
the patches when a new T3 build breaks them.

By hand on macOS (Node.js 18+, no npm dependencies):

```sh
git clone https://github.com/spklk/t3-timeline-tweaks.git ~/repos/t3-timeline-tweaks
cd ~/repos/t3-timeline-tweaks
node t3-timeline-tweaks.mjs dry-run          # check the patches match your T3 build
node t3-timeline-tweaks.mjs apply            # patch; the original is saved in ./backup
node t3-timeline-tweaks.mjs install-agent    # re-apply automatically after T3 updates
```

Then restart T3 Code. If `apply` fails with `EPERM`, add the `node` binary printed in the error under
System Settings → Privacy & Security → App Management and retry.

Platforms: the patch itself works anywhere T3 Code desktop runs. Automatic re-apply (`install-agent`)
is built in on macOS only; for Windows and Linux, AGENTS.md describes a launcher/scheduled task and an
apt hook. The app is found automatically (Nightly preferred); set `T3_APP` to an app directory or
`app.asar` to override.

## Commands

```sh
node t3-timeline-tweaks.mjs status           # patched? agent installed?
node t3-timeline-tweaks.mjs dry-run          # check patches still match current build
node t3-timeline-tweaks.mjs apply            # patch (backup in ./backup)
node t3-timeline-tweaks.mjs restore          # put the original app.asar back
node t3-timeline-tweaks.mjs install-agent    # macOS: re-apply automatically after updates
node t3-timeline-tweaks.mjs uninstall-agent  # macOS
```

Each "start expanded" default above can be switched off with `T3_COLLAPSE`, a comma-separated list
of `turns` (finished turns), `groups`, `thinking`, `rows` (command/tool rows) and `subagents`. Those keep
T3's collapsed default. `ok-rows` is `rows` except that failed commands and tools still start open (T3's
own "tool call failed" check: exit code, failed or declined status, error output):

```sh
T3_COLLAPSE=rows,subagents node t3-timeline-tweaks.mjs restore
T3_COLLAPSE=rows,subagents node t3-timeline-tweaks.mjs apply
T3_COLLAPSE=rows,subagents node t3-timeline-tweaks.mjs install-agent   # macOS: the agent keeps the choice
```

To change it later, run those three again with the new list (`restore` first, since `apply` skips an
already patched app).

To keep tool activity closed but still read everything the agent wrote, collapse all but `turns`:
`T3_COLLAPSE=groups,thinking,rows,subagents`. Finished turns then stay open, so every text part of a
turn stays visible.

Thought styling is set the same way with `T3_THOUGHTS`, a comma-separated list. Thoughts are always
muted grey; the list adds the rest:

| Option | Effect |
|---|---|
| `small` | smaller than replies (otherwise reply-sized) |
| `italic` | italic text |
| `line` | faint line down the left edge |
| `strong-line` | darker line instead |
| `plain` | none of these |

The default is `line,small`. For the older italic look without a line: `T3_THOUGHTS=italic,small`, used with
`restore`, `apply` and `install-agent` like `T3_COLLAPSE` above.

Tool rows are styled with `T3_TOOLS`, also a comma-separated list; when it is unset they look as in T3:

| Option | Effect |
|---|---|
| `small` | command/tool row titles and tool-group headers smaller than replies |
| `box` | expanded tool details (command, arguments, output) in a bordered box |
| `short` | command titles without a leading `cd <dir> &&` or `cd <dir>;` (quoted directories too); file titles show `/Users/<name>` or `/home/<name>` as `~` |

For example `T3_COLLAPSE=ok-rows T3_TOOLS=small,box,short` keeps successful commands folded, opens failed
ones, and keeps tool rows visually quieter than the agent's replies. The patched bundle has to stay the
same size as the original, so a few option combinations leave little room; if a T3 update makes one too
large, `apply` reports `grew by N bytes` and writes nothing.

Restart T3 Code after apply/restore. On macOS, after a T3 update the agent re-patches within seconds
(or 30 min at worst). If T3 relaunched less than 2 minutes earlier (the usual case right after an
update) the agent restarts it once more by itself. Otherwise T3 may be running sessions, so it asks first with
a "Restart now" / "Later" dialog (it closes itself as "Later" after 10 minutes). A second restart within a
minute (an update relaunching T3 right after the agent's restart) also asks first, so a restart loop
cannot happen and an unpatched T3 never keeps running unnoticed. Log: `~/Library/Logs/t3-timeline-tweaks.log`.
Keep the clone where it is: the agent and the backup live in it.

## How it works and caveats

It edits the minified timeline bundle (currently `ReadOnlyThreadTimeline-*.js`, earlier `useTimelineFollow-*.js` and `_chat-*.js`) inside T3's `app.asar` in place
with a list of regex patches (`PATCHES` in the script). The bundle keeps the same byte size, and the
asar integrity hashes are updated.

- Every patch must match an exact number of times, or nothing is written. When T3 ships code the
  patches don't recognise, `apply` aborts (with a macOS notification from the agent) and the app
  stays untouched. The regexes then need updating; AGENTS.md section 6 explains how.
- This modifies a signed app. It is not supported by T3; use it at your own risk.
  `restore` (or reinstalling T3 Code) undoes it.
- Last verified against `0.1.13-nightly.20261126.5305`. Only nightly builds have been checked.

## Getting fixes

Nothing updates your clone by itself. When a T3 update breaks the patch, a fixed version usually follows
here. To hear about it, click **Watch → Custom → Releases** on GitHub; a release is published automatically
whenever the script changes. Then:

```sh
git -C ~/repos/t3-timeline-tweaks pull
node ~/repos/t3-timeline-tweaks/t3-timeline-tweaks.mjs apply
```
