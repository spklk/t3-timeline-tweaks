# Agent guide: install t3-timeline-tweaks

You are installing a patch for the user's T3 Code desktop app and keeping it applied across T3 updates.
`README.md` lists what the patch changes. Everything happens through one dependency-free script:

```sh
node t3-timeline-tweaks.mjs status | dry-run | apply | restore | install-agent | uninstall-agent
```

Rules:

- Keep this clone where it is. The backup (`./backup`) and any scheduled re-apply job point at it.
- Never edit `app.asar` by hand and never "force" a patch. The script refuses to write when a patch
  does not match exactly; that is the safety net.
- Some steps need the user (OS permission dialogs, quitting T3 Code). Tell them exactly what to do and wait.

## 1. Preconditions

- Node.js 18+ (`node --version`). Install it if missing.
- T3 Code desktop installed. `status` prints the `app.asar` it found:

  ```sh
  node t3-timeline-tweaks.mjs status
  ```

  If it is not found or is the wrong install, set `T3_APP` to the app bundle/install directory or directly
  to `app.asar`. Nightly is preferred over stable when both exist. Typical locations:

  | Platform | app.asar |
  |---|---|
  | macOS | `/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar` (or `T3 Code.app`, or `~/Applications`) |
  | Windows | `%LOCALAPPDATA%\Programs\<T3 Code dir>\resources\app.asar` (per-user NSIS install) |
  | Linux `.deb` | `/opt/<T3 Code dir>/resources/app.asar` |
  | Linux AppImage | read-only; see below |

  The script searches those roots for a directory whose name contains `t3code`/`T3 Code`. If the
  directory name differs, find it with a search for `app.asar` and set `T3_APP`.

## 2. Check and apply (all platforms)

```sh
node t3-timeline-tweaks.mjs dry-run   # must print "All patches match." (or "Already patched")
node t3-timeline-tweaks.mjs apply
node t3-timeline-tweaks.mjs status    # must say "patched"
```

If `dry-run` reports `matched Nx, expected Mx`, the user's T3 build differs from the one the patches
were written for. Go to section 6; do not continue with `apply`.

Permission errors on `apply`:

- **macOS `EPERM`**: the user must open System Settings → Privacy & Security → App Management and add
  the `node` binary printed in the error (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles"`
  opens the pane). You cannot grant this yourself.
- **Windows `EBUSY`/`EPERM`**: T3 Code holds the file open. Ask the user to quit it fully (tray icon too),
  then retry. Under `Program Files` an elevated terminal is needed.
- **Linux `EACCES`**: `/opt` is root-owned. Run with `sudo -E env "PATH=$PATH" node t3-timeline-tweaks.mjs apply`.

Then ask the user to restart T3 Code.

Opt-outs: `T3_COLLAPSE` (comma list of `groups`, `thinking`, `rows`, `subagents`) keeps those starting
collapsed; see README.md. If the user sets it, it must also reach every re-apply job below: on macOS
run `install-agent` with it set; on Windows set it as a user environment variable like `T3_APP`; in the
Linux apt hook put `T3_COLLAPSE=... ` in front of the node command.

## 3. Keep it applied after T3 updates

Every T3 update replaces `app.asar` and drops the patch, so `apply` has to run again afterwards.
`apply` is idempotent: it exits quietly when the patch is present, so running it often is safe.

### macOS (built in)

```sh
node t3-timeline-tweaks.mjs install-agent
```

This installs a LaunchAgent that runs `apply --quiet` whenever `app.asar` changes, at login and every
30 minutes. Failures show a macOS notification. Log: `~/Library/Logs/t3-timeline-tweaks.log`.

The agent runs the `node` binary that ran `install-agent`, and that binary needs the App Management permission
from section 2. With Homebrew the path is version-specific: after `brew upgrade node`, grant the new
path and re-run `install-agent`.

Verify: run `restore`, wait about 15 seconds (launchd throttles restarts to one per 10 s), then
`status` must say `patched` again.

### Windows (set up yourself)

`install-agent` is macOS only. The patch can only be written while T3 Code is closed, so the most reliable
approach is to patch right before launch. Use both of the following:

1. A launcher that applies and then starts T3. Point the user's Start-menu/taskbar shortcut at it:

   ```powershell
   # %USERPROFILE%\t3-timeline-tweaks-launch.ps1
   $node   = (Get-Command node).Source
   $script = "C:\path\to\t3-timeline-tweaks\t3-timeline-tweaks.mjs"
   & $node $script apply --quiet *>> "$env:LOCALAPPDATA\t3-timeline-tweaks.log"
   Start-Process "$env:LOCALAPPDATA\Programs\<T3 Code dir>\<T3 Code exe>.exe"
   ```

   Shortcut target: `powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%USERPROFILE%\t3-timeline-tweaks-launch.ps1"`

2. A logon task as a fallback, for when T3 restarts itself after an update:

   ```powershell
   schtasks /Create /F /TN "t3-timeline-tweaks" /SC ONLOGON /RL LIMITED `
     /TR "`"$((Get-Command node).Source)`" `"C:\path\to\t3-timeline-tweaks\t3-timeline-tweaks.mjs`" apply --quiet"
   ```

Fill in the real paths (find the exe next to `resources\`). If you set `T3_APP`, set it for these too
(`[Environment]::SetEnvironmentVariable("T3_APP", "...", "User")`).

### Linux `.deb` (set up yourself)

Updates arrive through dpkg, so an apt hook re-applies after every package operation (it runs as root):

```sh
NODE="$(command -v node)"; SCRIPT="$PWD/t3-timeline-tweaks.mjs"
echo "DPkg::Post-Invoke { \"$NODE $SCRIPT apply --quiet >> /var/log/t3-timeline-tweaks.log 2>&1 || true\"; };" \
  | sudo tee /etc/apt/apt.conf.d/99-t3-timeline-tweaks
```

If the user's node lives in their home directory (nvm, fnm), root can still execute it by absolute path.
The backup is then written by root into `./backup`; that is fine.

### Linux AppImage

An AppImage is a read-only image and replaces itself on update, so it cannot be patched in place.
Recommend switching to the `.deb`. Otherwise: `./T3-Code-*.AppImage --appimage-extract`, set
`T3_APP=$PWD/squashfs-root`, run `apply`, and start T3 from `squashfs-root/AppRun`. Updates then have to be
re-extracted manually.

## 4. Verify with the user

After a restart of T3 Code, in a thread where the agent thinks and runs tools:

- "Thought" rows, tool groups, command/tool rows and subagent groups are expanded (unless opted out
  with `T3_COLLAPSE`); thinking text is small, italic and muted
- tool groups and thinking have no inner scrollbars
- while the agent works, a small italic shimmering "Working for Xs" line sits at the bottom

## 5. Undo

```sh
node t3-timeline-tweaks.mjs restore           # original app.asar back (or reinstall T3 Code)
node t3-timeline-tweaks.mjs uninstall-agent   # macOS
```

Windows: `schtasks /Delete /TN "t3-timeline-tweaks" /F` and remove the launcher/shortcut.
Linux: `sudo rm /etc/apt/apt.conf.d/99-t3-timeline-tweaks`.

## 6. When patches stop matching a new T3 build

The patches are regexes over T3's minified timeline bundle (`apps/server/dist/client/assets/useTimelineFollow-*.js`, earlier `_chat-*.js`)
inside `app.asar`. Minified identifiers change between builds, so the regexes use the `ID` wildcard
and anchor on stable strings: class names, `"Working for "`, `expandedWorkGroupIds`,
`calc(min(18rem, 50dvh)`, and so on. Each entry in `PATCHES` has a `name` that says what it does.

To update them:

1. Extract the bundle: `npx -y @electron/asar extract "<app.asar>" /tmp/t3x/out` (errors about unpacked
   files can be ignored). Open the `out/apps/server/dist/client/assets/*.js` file that contains `expandedWorkGroupIds`.
2. For each failing patch, find its anchor string, look at the new code around it, and adjust `re` and `count`.
   If the feature disappeared upstream, drop the patch.
3. Test on a copy only, so the real app and backup stay untouched:

   ```sh
   cp "<app.asar>" /tmp/t3x/app.asar
   T3_APP=/tmp/t3x/app.asar T3_BACKUP_DIR=/tmp/t3x/backup node t3-timeline-tweaks.mjs apply
   npx -y @electron/asar extract /tmp/t3x/app.asar /tmp/t3x/patched
   cp /tmp/t3x/patched/apps/server/dist/client/assets/useTimelineFollow-*.js /tmp/t3x/check.mjs
   node --check /tmp/t3x/check.mjs
   ```

4. The patched bundle must not be larger than the original (the script reports `grew by N bytes`). Keep
   replacements no longer than what they replace.
5. Apply for real, have the user restart T3 Code and check section 4. Update "Last verified against" in
   `README.md`.
