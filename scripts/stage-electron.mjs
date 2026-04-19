import {
  stat,
  readdir,
  readFile,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const standaloneSrc = resolve(root, ".next/standalone");
const stage = resolve(root, ".electron-stage/standalone");
const stageNm = resolve(stage, "node_modules");
const pnpmStore = resolve(root, "node_modules/.pnpm");
const rootPkgJson = resolve(root, "package.json");

let skippedLinks = 0;

// Recursive copy that follows symlinks but tolerates broken ones.
async function copyTree(from, to) {
  let s;
  try {
    s = await stat(from);
  } catch (err) {
    if (err.code === "ENOENT") {
      skippedLinks++;
      return;
    }
    throw err;
  }
  if (s.isDirectory()) {
    await mkdir(to, { recursive: true });
    const entries = await readdir(from, { withFileTypes: true });
    await Promise.all(
      entries.map((e) => copyTree(join(from, e.name), join(to, e.name)))
    );
    return;
  }
  if (s.isFile()) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

// Find every package.json matching `name` anywhere in the pnpm virtual store.
async function findPackageManifests(name, storeEntries) {
  const hits = [];
  for (const e of storeEntries) {
    if (!e.isDirectory()) continue;
    const pkgJson = join(pnpmStore, e.name, "node_modules", name, "package.json");
    const data = await readJson(pkgJson);
    if (data) hits.push({ dir: dirname(pkgJson), pkg: data });
  }
  return hits;
}

// Walk production deps (+ their peer/optional deps, transitively) starting from
// the root package.json. Returns a Set of package names that belong in the
// shipped node_modules.
async function computeProdClosure() {
  const storeEntries = await readdir(pnpmStore, { withFileTypes: true });
  const rootPkg = await readJson(rootPkgJson);
  const seen = new Set();
  const queue = Object.keys(rootPkg.dependencies || {});

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const manifests = await findPackageManifests(name, storeEntries);
    for (const { pkg } of manifests) {
      for (const key of ["dependencies", "peerDependencies", "optionalDependencies"]) {
        for (const dep of Object.keys(pkg[key] || {})) {
          if (!seen.has(dep)) queue.push(dep);
        }
      }
    }
  }
  return seen;
}

// For each package in the production closure, copy one version from the pnpm
// virtual store into the staged node_modules (first hit wins).
async function flattenPnpmStore(closure) {
  const storeEntries = await readdir(pnpmStore, { withFileTypes: true });
  for (const v of storeEntries) {
    if (!v.isDirectory() || v.name === "node_modules") continue;
    const nm = join(pnpmStore, v.name, "node_modules");
    let pkgs;
    try {
      pkgs = await readdir(nm, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const pkg of pkgs) {
      if (pkg.name.startsWith(".")) continue;
      if (pkg.name.startsWith("@")) {
        let scoped;
        try {
          scoped = await readdir(join(nm, pkg.name), { withFileTypes: true });
        } catch {
          continue;
        }
        for (const s of scoped) {
          const full = `${pkg.name}/${s.name}`;
          if (!closure.has(full)) continue;
          const target = join(stageNm, pkg.name, s.name);
          if (await exists(target)) continue;
          await copyTree(join(nm, pkg.name, s.name), target);
        }
      } else {
        if (!closure.has(pkg.name)) continue;
        const target = join(stageNm, pkg.name);
        if (await exists(target)) continue;
        await copyTree(join(nm, pkg.name), target);
      }
    }
  }
}

await rm(stage, { recursive: true, force: true });
await mkdir(dirname(stage), { recursive: true });

await copyTree(standaloneSrc, stage);
await copyTree(resolve(root, ".next/static"), resolve(stage, ".next/static"));
await copyTree(resolve(root, "public"), resolve(stage, "public"));

const closure = await computeProdClosure();
await flattenPnpmStore(closure);

console.log(
  `staged standalone at ${stage} (${closure.size} prod deps)` +
    (skippedLinks
      ? ` — skipped ${skippedLinks} broken symlink${skippedLinks > 1 ? "s" : ""}`
      : "")
);
