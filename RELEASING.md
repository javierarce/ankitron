# Releasing Ankitron

Releases are cut by pushing a `v*` tag. That triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
the universal macOS app, signs + notarizes it with the GitHub Secrets (no local
signing needed), and publishes `Ankitron.dmg` plus `latest.json` (for the in-app
updater) to a GitHub release.

> [!IMPORTANT]
> **The version bump must be committed _before_ you tag, and the tag must point
> at that bump commit.** `tauri-action` reads the version straight out of
> `tauri.conf.json` at the tagged commit and writes it into `latest.json`. If
> you tag first and bump afterwards, `latest.json` carries the old version, the
> updater thinks nothing changed, and everyone is stuck on the previous release.

## Steps

### 1. Make sure `main` is up to date

Everything for the release must be merged and pushed to `origin/main`.

```bash
git checkout main
git pull
```

### 2. Bump the version in all four files (they must match)

| File | Field |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/Cargo.lock` | the `[[package]]` block for `name = "ankitron"` |

Easiest path: edit the first three, then refresh the lockfile automatically:

```bash
(cd src-tauri && cargo check)
```

`cargo check` rewrites `Cargo.lock` to match `Cargo.toml`, so you don't have to
edit it by hand.

### 3. Commit and push the bump

```bash
git commit -am "vX.Y.Z"
git push origin main
```

### 4. Tag the bump commit and push the tag

The tag must start with `v` and point at the commit you just pushed (HEAD).

```bash
git tag -a vX.Y.Z -m "Short title" -m "- Did X" -m "- Fixed Y"
git push origin vX.Y.Z
```

Notes from the annotated tag's message become the release notes and the
updater's "what's new" text. If you cut a lightweight tag (no message), the
workflow falls back to commit subjects since the previous tag instead.

> [!NOTE]
> Keep the notes **plain text**. The in-app updater renders them as raw text,
> so Markdown like `**bold**` or `##` shows up literally. Use a plain headline
> line and `-` bullets.

### 5. Watch the build

```bash
gh run watch
```

The job builds, signs, notarizes, and staples the app and dmg. It publishes only
after notarization succeeds — until then the release stays a **draft**, so a
failed build never ships a broken release.

### 6. If it fails

```bash
gh run view <run-id> --log-failed
```

- **"The timestamp service is not available"** → transient Apple outage. Just
  retry; it's always safe because a failed run never leaves a published release:
  ```bash
  gh run rerun <run-id>
  ```

### 7. Verify the release

Confirm `latest.json` reports the version you just cut:

```bash
curl -sL https://github.com/javierarce/ankitron/releases/latest/download/latest.json | jq -r .version
```

It should print `X.Y.Z`. If it prints the previous version, the tag was almost
certainly cut before the bump commit — see the warning at the top.

### 8. Edit release notes (optional)

This updates the GitHub release body only (not `latest.json`), so prefer
getting the tag message right in step 4. Keep it plain text — see the note there.

```bash
gh release edit vX.Y.Z --notes "Ankitron X.Y.Z — short title
- Did X
- Fixed Y"
```
