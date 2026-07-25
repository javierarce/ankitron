#!/usr/bin/env node
// Cuts a release. Bumps the version in every file that carries it, opens an
// editor for the release notes, commits, tags, and pushes.
//
// Pushing the tag is what actually ships: .github/workflows/release.yml fires
// on any `v*` tag and builds, signs, notarizes, and publishes the app. It reads
// the release notes from the *annotated* tag's message (subject + body) and
// copies them into both the GitHub release body and latest.json's `notes`,
// which is what the in-app updater shows. That's why the tag here is always
// annotated (`-a`) with hand-written notes — a lightweight tag would silently
// fall back to raw commit subjects.
//
//   pnpm release             # interactive
//   pnpm release --dry-run   # show everything, write nothing
//
// Flags: --dry-run, --no-fetch (skip the origin sync check),
//        --any-branch (release from somewhere other than main),
//        --skip-checks (skip lint + tests).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const noFetch = args.has("--no-fetch");
const anyBranch = args.has("--any-branch");
const skipChecks = args.has("--skip-checks");

const RELEASE_BRANCH = "main";
const REMOTE = "origin";

// Every file carrying the app version. Each pattern has three groups —
// prefix, version, suffix — so the replace only ever rewrites the version
// itself, and the old value can be checked against package.json first. The
// regexes are deliberately non-global: only the first (top-level) match.
const VERSION_SITES = [
  // Top-level "version" key. It is the first one in the file — dependency pins
  // are "name": "^1.2.3", never a "version" key.
  { path: "package.json", pattern: /("version": ")([^"]+)(")/ },
  { path: "src-tauri/tauri.conf.json", pattern: /("version": ")([^"]+)(")/ },
  // Anchored to the package block so a dependency's version is never hit.
  {
    path: "src-tauri/Cargo.toml",
    pattern: /(\[package\]\r?\nname = "ankitron"\r?\nversion = ")([^"]+)(")/,
  },
  {
    path: "src-tauri/Cargo.lock",
    pattern: /(\[\[package\]\]\r?\nname = "ankitron"\r?\nversion = ")([^"]+)(")/,
  },
];

const NOTES_TEMPLATE_HELP = `
# Write the release notes above.
#
# The first line is the release title (a short summary of the release, no
# version number — the version is already the tag name). Leave a blank line,
# then describe the changes as bullets, in prose, for people who do not read
# commit logs.
#
# The commit subjects since the last release are pre-filled as a starting
# point. Rewrite them — these notes are what users see in the GitHub release
# and in the in-app updater.
#
# Lines starting with # are ignored. An empty message aborts the release.
`.trimStart();

const bail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

function git(gitArgs, { allowFailure = false } = {}) {
  const r = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    if (allowFailure) return null;
    bail(`git ${gitArgs.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit" }).status === 0;
}

// Prompts read through readline's async iterator rather than question(), which
// races on non-TTY input: piped lines are all emitted at once, so any line
// arriving between two question() calls is dropped and the next await never
// settles. The iterator queues them. EOF is a hard error — never a silent exit.
let rl = null;
let lines = null;
const ask = async (q) => {
  rl ??= createInterface({ input: process.stdin });
  lines ??= rl[Symbol.asyncIterator]();
  process.stdout.write(q);
  const { value, done } = await lines.next();
  if (done) bail("Input ended (EOF) while waiting for an answer.");
  return value.trim();
};
const closePrompt = () => {
  rl?.close();
  rl = null;
  lines = null;
};

// Before spawning the editor, release stdin so readline does not compete with
// it for input — but only on a TTY. With piped input there is no terminal to
// hand over, and closing would discard the lines readline has already buffered
// from the pipe, i.e. the answers to the prompts after the editor.
const releaseStdinForEditor = () => {
  if (process.stdin.isTTY) closePrompt();
};

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? m.slice(1, 4).map(Number) : null;
}

function bumpVersion(v, kind) {
  const [major, minor, patch] = parseVersion(v);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const isNewer = (next, current) => {
  const a = parseVersion(next);
  const b = parseVersion(current);
  return a.some((n, i) => n > b[i] && a.slice(0, i).every((x, j) => x === b[j]));
};

// ---------------------------------------------------------------- preflight

if (git(["status", "--porcelain"])) {
  bail("Working tree is not clean. Commit or stash first.");
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== RELEASE_BRANCH && !anyBranch) {
  bail(
    `On "${branch}", but releases are cut from "${RELEASE_BRANCH}".\n` +
      `  Switch branches, or pass --any-branch if this is deliberate.`,
  );
}

if (!noFetch) {
  console.log(`Fetching ${REMOTE}…`);
  git(["fetch", REMOTE, branch, "--tags"], { allowFailure: true });
  const remoteHead = git(["rev-parse", `${REMOTE}/${branch}`], {
    allowFailure: true,
  });
  const localHead = git(["rev-parse", "HEAD"]);
  if (remoteHead && remoteHead !== localHead) {
    // Ahead means unpushed work that CI has never seen; behind or diverged
    // means the release would omit merged PRs. Neither is safe to ship.
    const ahead = git(["rev-list", "--count", `${REMOTE}/${branch}..HEAD`]);
    const behind = git(["rev-list", "--count", `HEAD..${REMOTE}/${branch}`]);
    bail(
      `Local ${branch} is out of sync with ${REMOTE}/${branch} ` +
        `(${ahead} ahead, ${behind} behind).\n` +
        `  Push or pull first, or pass --no-fetch to skip this check.`,
    );
  }
}

// ------------------------------------------------------- version + changes

const pkgPath = join(root, "package.json");
const currentVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
if (!parseVersion(currentVersion)) {
  bail(`Could not read a valid version from package.json (got "${currentVersion}").`);
}

// Locate the version in every file up front, so a pattern that no longer
// matches (or a file left out of sync by a half-finished release) fails here
// rather than halfway through the apply — and so --dry-run covers it too.
const sites = VERSION_SITES.map(({ path, pattern }) => {
  const content = readFileSync(join(root, path), "utf8");
  const match = pattern.exec(content);
  if (!match) bail(`Could not find the version in ${path}.`);
  if (match[2] !== currentVersion) {
    bail(
      `${path} is at ${match[2]}, but package.json says ${currentVersion}.\n` +
        `  Versions are out of sync — fix them by hand first.`,
    );
  }
  return { path, pattern, content };
});

// The previous release tag. Normally v<currentVersion>; fall back to the most
// recent reachable tag if that one is missing (e.g. a bump that never shipped).
const currentTag = `v${currentVersion}`;
const prevTag =
  git(["rev-parse", "--verify", "--quiet", `refs/tags/${currentTag}`], {
    allowFailure: true,
  }) !== null
    ? currentTag
    : git(["describe", "--tags", "--abbrev=0"], { allowFailure: true });

// Commit subjects since that tag, minus the version-bump commits themselves
// (they are titled "v0.56.0" and carry no user-visible meaning).
const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
const changes = git(["log", "--no-merges", "--pretty=format:%s", range])
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s && !/^v?\d+\.\d+\.\d+$/.test(s));

console.log(`\nCurrent version: ${currentVersion}`);
console.log(`Changes since ${prevTag ?? "the beginning"}:\n`);
if (changes.length === 0) {
  console.log("  (none)\n");
  const go = await ask("No changes since the last release. Continue anyway? [y/N] ");
  if (!/^y(es)?$/i.test(go)) bail("Aborted.");
} else {
  for (const c of changes) console.log(`  · ${c}`);
  console.log();
}

const choices = {
  1: ["patch", bumpVersion(currentVersion, "patch")],
  2: ["minor", bumpVersion(currentVersion, "minor")],
  3: ["major", bumpVersion(currentVersion, "major")],
};
for (const [key, [kind, v]] of Object.entries(choices)) {
  console.log(`  ${key}) ${kind.padEnd(5)} ${v}${kind === "minor" ? "   (default)" : ""}`);
}
console.log("  4) custom");

let nextVersion;
while (!nextVersion) {
  const answer = (await ask("\nNew version? [2] ")) || "2";
  const picked = choices[answer];
  const candidate = picked
    ? picked[1]
    : answer === "4"
      ? await ask("Version (x.y.z): ")
      : answer;

  if (!parseVersion(candidate)) {
    console.log(`  "${candidate}" is not a valid x.y.z version.`);
  } else if (!isNewer(candidate, currentVersion)) {
    console.log(`  ${candidate} is not newer than ${currentVersion}.`);
  } else if (
    git(["rev-parse", "--verify", "--quiet", `refs/tags/v${candidate}`], {
      allowFailure: true,
    }) !== null
  ) {
    console.log(`  Tag v${candidate} already exists.`);
  } else {
    nextVersion = candidate;
  }
}
const nextTag = `v${nextVersion}`;

// ------------------------------------------------------------ release notes

const notesFile = join(tmpdir(), `ankitron-release-${nextVersion}.md`);
const prefill = changes.map((c) => `- ${c.replace(/\s*\(#\d+\)$/, "")}`).join("\n\n");
writeFileSync(notesFile, `\n\n${prefill}\n\n${NOTES_TEMPLATE_HELP}`);

const editor =
  process.env.GIT_EDITOR ||
  git(["config", "--get", "core.editor"], { allowFailure: true }) ||
  process.env.VISUAL ||
  process.env.EDITOR ||
  "vi";

console.log(`\nOpening ${editor} for the release notes…`);
releaseStdinForEditor();
// Via the shell: core.editor may carry flags (e.g. "code --wait").
spawnSync(`${editor} "${notesFile}"`, { cwd: root, stdio: "inherit", shell: true });

const notes = readFileSync(notesFile, "utf8")
  .split("\n")
  .filter((line) => !line.startsWith("#"))
  .join("\n")
  .trim();
unlinkSync(notesFile);

if (!notes) bail("Empty release notes — aborted.");

// ------------------------------------------------------------------ confirm

console.log(`\n${"─".repeat(60)}`);
console.log(`${currentVersion}  →  ${nextVersion}`);
console.log(`${"─".repeat(60)}\n${notes}\n${"─".repeat(60)}\n`);

// The tag's first line is its subject, which the updater shows as the release
// headline. A bullet there means the title line was left unwritten.
if (notes.split("\n")[0].startsWith("-")) {
  console.log("! The notes start with a bullet, so this release has no title line.\n");
}
console.log("Will:");
console.log(`  · bump ${VERSION_SITES.length} files to ${nextVersion}`);
console.log(`  · commit "${nextTag}"`);
console.log(`  · create annotated tag ${nextTag} with the notes above`);
console.log(`  · push ${branch} and ${nextTag} to ${REMOTE}  ← starts the release build`);

if (dryRun) {
  console.log("\n--dry-run: nothing was written.\n");
  closePrompt();
  process.exit(0);
}

if (!skipChecks) {
  console.log("\nRunning lint + tests…\n");
  // release.yml never runs these — it only builds and signs. CI covers pushes
  // to main, but a local run here catches a break before the tag goes out.
  if (!run("pnpm", ["lint"])) bail("Lint failed. Fix it, or pass --skip-checks.");
  if (!run("pnpm", ["test"])) bail("Tests failed. Fix them, or pass --skip-checks.");
}

const confirm = await ask(`\nRelease ${nextTag}? [y/N] `);
closePrompt();
if (!/^y(es)?$/i.test(confirm)) bail("Aborted. Nothing was written.");

// -------------------------------------------------------------------- apply

for (const { path, pattern, content } of sites) {
  writeFileSync(join(root, path), content.replace(pattern, `$1${nextVersion}$3`));
  console.log(`  bumped ${path}`);
}

git(["add", ...sites.map((s) => s.path)]);
git(["commit", "-m", nextTag]);
console.log(`  committed ${nextTag}`);

// allowFailure + null check, not try/catch: git() reports failure through
// bail(), which exits rather than throwing. A signing failure (tag.gpgSign with
// no usable key) would otherwise leave an untagged bump commit and no hint.
if (git(["tag", "-a", nextTag, "-m", notes], { allowFailure: true }) === null) {
  bail(
    `Tagging ${nextTag} failed, but the bump commit was already made.\n` +
      `  Undo it with:  git reset --hard HEAD~1`,
  );
}
console.log(`  tagged ${nextTag}`);

// Always push explicit refspecs, never a bare `git push`: a global
// push.default=matching would otherwise push every same-named local branch.
console.log(`\nPushing to ${REMOTE}…`);
const pushedBranch = git(["push", REMOTE, `refs/heads/${branch}:refs/heads/${branch}`], {
  allowFailure: true,
});
if (pushedBranch === null) {
  bail(
    `Pushing ${branch} failed. The commit and tag exist locally. Retry with:\n` +
      `    git push ${REMOTE} refs/heads/${branch}:refs/heads/${branch}\n` +
      `    git push ${REMOTE} refs/tags/${nextTag}\n` +
      `  Or undo with:  git tag -d ${nextTag} && git reset --hard HEAD~1`,
  );
}
git(["push", REMOTE, `refs/tags/${nextTag}`]);

const repo = (git(["remote", "get-url", REMOTE]) ?? "")
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
console.log(`\n✓ Released ${nextTag}`);
console.log(`  Build:   ${repo}/actions`);
console.log(`  Release: ${repo}/releases/tag/${nextTag}\n`);
