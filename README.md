# t3-timeline-tweaks

An unofficial local patch for the [T3 Code](https://github.com/pingdotgg/t3code) desktop app.
It makes the agent's thinking readable, keeps it expanded, and makes it obvious when the agent is
still working.

What it changes:

- work groups (tool/thinking runs) start expanded; clicking still collapses them
- finished turns are no longer folded into "Worked for Xs"
- "Thought" rows start expanded
- thinking text is muted (`text-secondary-label`), italic and smaller than replies (`text-xs`, 12px vs 14px)
- the "Working for Xs" timer sits at the bottom of the timeline while the agent works, instead of
  under your message where expanded output scrolls it out of view; it shimmers like "Thinking" and
  uses small italic text in the thinking color so it reads as a status line; its shimmer is the same
  grey-text/white-band shine as the "Thinking" row
- the thinking panel's 384px max-height cap and its own scroll container are removed (no inner scrollbar)
- the tool-call group is no longer capped at min(18rem, 50dvh); it grows with its content instead of scrolling

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

Restart T3 Code after apply/restore. On macOS, after a T3 update the agent re-patches within seconds
(or 30 min at worst), and a restart is needed again. Log: `~/Library/Logs/t3-timeline-tweaks.log`.
Keep the clone where it is: the agent and the backup live in it.

## How it works and caveats

It edits the minified `_chat-*.js` bundle inside T3's `app.asar` in place
with a list of regex patches (`PATCHES` in the script). The bundle keeps the same byte size, and the
asar integrity hashes are updated.

- Every patch must match an exact number of times, or nothing is written. When T3 ships code the
  patches don't recognise, `apply` aborts (with a macOS notification from the agent) and the app
  stays untouched. The regexes then need updating; AGENTS.md section 6 explains how.
- This modifies a signed app. It is not supported by T3; use it at your own risk.
  `restore` (or reinstalling T3 Code) undoes it.
- Last verified against `0.1.3-nightly.20261023.3566`.
