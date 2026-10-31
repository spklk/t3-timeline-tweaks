#!/usr/bin/env node
// Local patch for T3 Code: expanded, readable thinking and a visible "Working for" status.
// See README.md for the list of changes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const ASAR = findAsar();
const ASSETS_DIR = "apps/server/dist/client/assets";
const BACKUP_DIR = process.env.T3_BACKUP_DIR ?? path.join(HERE, "backup");
const LABEL = "local.t3-timeline-tweaks";
const PLIST = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const LOG = path.join(os.homedir(), "Library/Logs/t3-timeline-tweaks.log");
const MARKER = "/*t3xt*/";
const ID = "[\\w$]+";

// Each patch must match exactly `count` times, otherwise nothing is written.
const PATCHES = [
  {
    name: "work groups start expanded (Set now tracks collapsed groups)",
    re: new RegExp(`(${ID})\\.expandedWorkGroupIds\\?\\.has\\((${ID})\\)\\?\\?!1`, "g"),
    to: (_, state, id) => `!${state}.expandedWorkGroupIds?.has(${id})`,
    count: 4,
  },
  {
    name: "finished turns do not hide their work",
    re: new RegExp(`if\\(!${ID}\\.expandedRunIds\\?\\.has\\(${ID}\\.runId\\)\\)\\{`, "g"),
    to: () => "if(!1){",
    count: 1,
  },
  {
    name: "no 'Worked for …' turn-fold row",
    re: new RegExp(`if\\((${ID})\\)\\{(let ${ID}=[^;]{0,40}?\\1\\.entryIds\\b)`, "g"),
    to: (_, _fold, rest) => `if(!1){${rest}`,
    count: 1,
  },
  {
    name: "thought rows start expanded",
    re: new RegExp(`\\(\\)=>(${ID})\\?\\.state\\.expandedEntries\\.has\\((${ID})\\.id\\)\\?\\?!1`, "g"),
    to: (_, view, entry) => `()=>${view}?.state.expandedEntries.has(${entry}.id)||${entry}.itemType===\`reasoning\``,
    count: 1,
  },
  {
    name: "reasoning text is muted, italic, and smaller than replies (text-xs vs text-sm)",
    re: new RegExp(`className:\`text-foreground\`,text:(${ID})\\.detail\\?\\?\``, "g"),
    to: (_, entry) => `className:\`text-secondary-label italic text-xs\`,text:${entry}.detail??\``,
    count: 1,
  },
  {
    name: "'Working for …' row is not inserted under the user message",
    re: new RegExp(`${ID}\\.isWorking&&${ID}===${ID}&&${ID}\\(\\),`, "g"),
    to: () => "",
    count: 1,
  },
  {
    name: "'Working for …' row goes at the bottom of the timeline while working",
    re: new RegExp(`&&!(${ID})&&${ID}===${ID}\\.length&&(${ID})\\(\\)`, "g"),
    to: (_, hasRow, push) => `&&!${hasRow}&&${push}()`,
    count: 1,
  },
  {
    name: "'Working for …' row: top divider (it sits at the bottom) and small italic thinking-colored status text",
    re: /className:`border-b border-border\/60 pb-2 pt-1`(,children:\(0,\$\.jsxs\)\(`div`,\{className:`flex h-6 min-w-0 items-baseline gap-2 px-1 )text-sm leading-relaxed text-muted-foreground( tabular-nums`)/g,
    to: (_, mid, tail) =>
      `className:\`border-t border-border/60 pb-1 pt-2\`${mid}text-xs italic leading-relaxed text-secondary-label${tail}`,
    count: 1,
  },
  {
    name: "'Working for …' row always shimmers (upstream only does it while compacting/preparing)",
    re: new RegExp(
      `(\\{isCompacting:${ID},isPreparingWorktree:${ID},backgroundWorktreeSetup:${ID}\\}=\\(0,${ID}\\.use\\)\\(${ID}\\),(?:${ID}=[^,]*,)?(${ID}))=${ID}\\|\\|${ID},`,
      "g",
    ),
    to: (_, head) => `${head}=!0,`,
    count: 1,
  },
  {
    name: "'Working for …' shimmer matches the brain icon: muted icon-grey text under the white overlay band",
    re: new RegExp(
      `(\`Working\\.\\.\\.\`[^]{0,400}?className:\`relative shrink-0 overflow-hidden whitespace-nowrap)\``,
      "g",
    ),
    to: (_, head) => `${head} text-icon-muted\``,
    count: 1,
  },
  {
    name: "tool-call group grows with its content instead of scrolling past min(18rem, 50dvh)",
    re: new RegExp(`(let ${ID}=)\`calc\\(min\\(18rem, 50dvh\\) \\+ \\$\\{${ID}\\}px\\)\``, "g"),
    to: (_, head) => `${head}\`none\``,
    count: 1,
  },
  {
    name: "reasoning panel has no max-height cap and never scrolls itself",
    re: /ms-7 flex max-h-96 flex-col gap-3 overflow-auto/g,
    to: () => "ms-7 flex flex-col gap-3 overflow-visible",
    count: 1,
  },
  {
    name: "strip sourceMappingURL comment to free space for the style patches",
    re: /\n\/\/# sourceMappingURL=[\w.-]+\.js\.map/g,
    to: () => "",
    count: 1,
  },
];

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

// T3_APP may point at the app (bundle or install dir) or directly at app.asar.
function asarIn(appPath) {
  if (appPath.endsWith(".asar")) return appPath;
  return path.join(appPath, IS_MAC ? "Contents/Resources/app.asar" : "resources/app.asar");
}

function installRoots() {
  if (IS_MAC) return ["/Applications", path.join(os.homedir(), "Applications")];
  if (IS_WIN) {
    return [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
      process.env.ProgramFiles,
    ].filter(Boolean);
  }
  return ["/opt", path.join(os.homedir(), "Applications"), path.join(os.homedir(), ".local/opt")];
}

function findAsar() {
  if (process.env.T3_APP) return asarIn(process.env.T3_APP);
  const found = [];
  for (const root of installRoots()) {
    let names;
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/t3[ -]?code/i.test(name)) continue;
      const asar = asarIn(path.join(root, name));
      if (fs.existsSync(asar)) found.push(asar);
    }
  }
  found.sort((a, b) => Number(/nightly/i.test(b)) - Number(/nightly/i.test(a)));
  return found[0] ?? asarIn(path.join(installRoots()[0] ?? ".", IS_MAC ? "T3 Code.app" : "T3 Code"));
}

function appVersion() {
  const fd = fs.openSync(ASAR, "r");
  try {
    const { header, dataStart } = readHeader(fd);
    const node = header.files["package.json"];
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset));
    return JSON.parse(buf.toString("utf8")).version;
  } finally {
    fs.closeSync(fd);
  }
}

function readHeader(fd) {
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, 0);
  const headerPickleSize = sizeBuf.readUInt32LE(4);
  const headerBuf = Buffer.alloc(headerPickleSize);
  fs.readSync(fd, headerBuf, 0, headerPickleSize, 8);
  const jsonLen = headerBuf.readUInt32LE(4);
  const json = headerBuf.subarray(8, 8 + jsonLen).toString("utf8");
  const header = JSON.parse(json);
  if (JSON.stringify(header) !== json) throw new Error("Unexpected asar header encoding");
  return { header, jsonLen, dataStart: 8 + headerPickleSize };
}

function readArchive(file) {
  const fd = fs.openSync(file, "r");
  try {
    const { header, jsonLen, dataStart } = readHeader(fd);

    let dir = header;
    for (const part of ASSETS_DIR.split("/")) {
      dir = dir.files?.[part];
      if (!dir) throw new Error(`${ASSETS_DIR} not found in app.asar`);
    }
    const names = Object.keys(dir.files).filter((n) => n.endsWith(".js"));
    names.sort((a, b) => Number(b.startsWith("_chat-")) - Number(a.startsWith("_chat-")));
    for (const name of names) {
      const node = dir.files[name];
      if (node.unpacked || node.size === undefined) continue;
      const content = Buffer.alloc(node.size);
      fs.readSync(fd, content, 0, node.size, dataStart + Number(node.offset));
      const text = content.toString("utf8");
      if (text.includes("expandedWorkGroupIds") || text.includes(MARKER)) {
        return { header, jsonLen, dataStart, node, name, text };
      }
    }
    throw new Error("Timeline bundle not found in app.asar");
  } finally {
    fs.closeSync(fd);
  }
}

function patchText(text) {
  let out = text;
  for (const p of PATCHES) {
    if (typeof p.to !== "function") throw new Error(`Patch "${p.name}" has no replacement function.`);
    const hits = out.match(p.re)?.length ?? 0;
    if (hits !== p.count) {
      throw new Error(`Patch "${p.name}" matched ${hits}x, expected ${p.count}x. T3 changed; update the script.`);
    }
    out = out.replace(p.re, p.to);
  }
  const original = Buffer.byteLength(text);
  const patched = Buffer.byteLength(out) + Buffer.byteLength(MARKER);
  if (patched > original) throw new Error(`Patched bundle grew by ${patched - original} bytes`);
  return out + MARKER + " ".repeat(original - patched);
}

function integrityFor(buf, blockSize) {
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const blocks = [];
  for (let i = 0; i < buf.length; i += blockSize) blocks.push(sha(buf.subarray(i, i + blockSize)));
  return { hash: sha(buf), blocks };
}

function notify(message) {
  if (!IS_MAC) return;
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "T3 timeline tweaks"`]);
  } catch {}
}

function apply({ quiet }) {
  if (!fs.existsSync(ASAR)) throw new Error(`Not found: ${ASAR}`);
  const version = appVersion();
  const archive = readArchive(ASAR);
  if (archive.text.includes(MARKER)) {
    if (!quiet) log(`Already patched (${version}).`);
    return;
  }
  let patched;
  try {
    patched = Buffer.from(patchText(archive.text), "utf8");
  } catch (error) {
    // Notify once per version instead of on every scheduled run.
    const flag = path.join(BACKUP_DIR, `.failed-${version}`);
    if (quiet && fs.existsSync(flag)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(flag, error.message);
    throw error;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const f of fs.readdirSync(BACKUP_DIR)) fs.rmSync(path.join(BACKUP_DIR, f));
  fs.copyFileSync(ASAR, path.join(BACKUP_DIR, `app.asar.${version}`), fs.constants.COPYFILE_FICLONE);

  const { node } = archive;
  if (node.integrity) Object.assign(node.integrity, integrityFor(patched, node.integrity.blockSize));
  const json = Buffer.from(JSON.stringify(archive.header), "utf8");
  if (json.length !== archive.jsonLen) throw new Error("Header size changed; aborting");

  const tmp = `${ASAR}.t3xt-tmp`;
  fs.copyFileSync(ASAR, tmp, fs.constants.COPYFILE_FICLONE);
  const fd = fs.openSync(tmp, "r+");
  try {
    fs.writeSync(fd, json, 0, json.length, 16);
    fs.writeSync(fd, patched, 0, patched.length, archive.dataStart + Number(node.offset));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const check = readArchive(tmp);
  if (!check.text.includes(MARKER) || check.text.length !== archive.text.length) {
    fs.rmSync(tmp);
    throw new Error("Verification of patched archive failed");
  }
  fs.renameSync(tmp, ASAR);
  log(`Patched ${version} (${archive.name}). Restart T3 Code to apply.`);
  if (quiet) notify(`Patched T3 Code ${version}. Restart T3 Code to see the changes.`);
}

function restore() {
  const version = appVersion();
  const backup = path.join(BACKUP_DIR, `app.asar.${version}`);
  if (!fs.existsSync(backup)) {
    log(`No backup for ${version}; installed app is ${readArchive(ASAR).text.includes(MARKER) ? "patched" : "unpatched"}.`);
    return;
  }
  const tmp = `${ASAR}.t3xt-tmp`;
  fs.copyFileSync(backup, tmp, fs.constants.COPYFILE_FICLONE);
  fs.renameSync(tmp, ASAR);
  log(`Restored original ${version}. Restart T3 Code.`);
}

function status() {
  const archive = readArchive(ASAR);
  const agent = IS_MAC ? `; agent ${fs.existsSync(PLIST) ? "installed" : "not installed"}` : "";
  log(`${appVersion()} at ${ASAR}: ${archive.text.includes(MARKER) ? "patched" : "not patched"}${agent}.`);
}

function xml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function requireMac() {
  if (!IS_MAC) {
    throw new Error("install-agent/uninstall-agent are macOS only. On Windows/Linux, set up re-apply as described in AGENTS.md.");
  }
}

function installAgent() {
  requireMac();
  const script = fileURLToPath(import.meta.url);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string><string>apply</string><string>--quiet</string></array>
  <key>EnvironmentVariables</key><dict><key>T3_APP</key><string>${xml(ASAR)}</string></dict>
  <key>WatchPaths</key><array><string>${xml(ASAR)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  const domain = `gui/${process.getuid()}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["bootstrap", domain, PLIST]);
  log(`LaunchAgent installed; re-applies after updates. Log: ${LOG}`);
}

function uninstallAgent() {
  requireMac();
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
  } catch {}
  fs.rmSync(PLIST, { force: true });
  log("LaunchAgent removed.");
}

const [cmd = "status", ...flags] = process.argv.slice(2);
const quiet = flags.includes("--quiet");
const commands = {
  apply: () => apply({ quiet }),
  "dry-run": () => {
    const { text } = readArchive(ASAR);
    if (text.includes(MARKER)) return log("Already patched; run restore first to dry-run against the original.");
    patchText(text);
    log("All patches match.");
  },
  restore,
  status,
  "install-agent": installAgent,
  "uninstall-agent": uninstallAgent,
};
if (!commands[cmd]) {
  console.log(`Usage: ${path.basename(process.argv[1])} <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
try {
  commands[cmd]();
} catch (error) {
  if (["EPERM", "EACCES", "EBUSY"].includes(error.code)) {
    error.message += IS_MAC
      ? `\nmacOS blocked writing to the app. Add ${process.execPath} under System Settings → Privacy & Security → App Management, then retry.`
      : IS_WIN
        ? "\nQuit T3 Code completely (including the tray icon), then retry. If it is installed under Program Files, run from an elevated terminal."
        : "\nThe app directory is not writable. Re-run with sudo (e.g. sudo -E node ...) for system installs such as /opt.";
  }
  log(`ERROR: ${error.message}`);
  if (quiet) notify(`Patch failed: ${error.message}`);
  process.exit(1);
}
