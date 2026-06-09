import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// Rasterize from the 1024px PNG master, NOT build/icon.svg. The SVG uses Figma
// filter/gradient features (e.g. a gradient with two stops at the same offset)
// that librsvg — sharp's SVG renderer — draws differently, producing artifacts.
// build/icon.svg is kept as the editable design source; build/icon.png is the
// rendered master. Re-export build/icon.png from the design tool when the icon
// changes, then run `pnpm icons`. App bundle icons: `pnpm tauri icon build/icon.png`.
const master = resolve(root, "build/icon.png");

const targets = [
  { path: "src/app/icon.png", size: 512 },
  { path: "public/apple-touch-icon.png", size: 180 },
];

for (const { path, size } of targets) {
  const out = resolve(root, path);
  await mkdir(dirname(out), { recursive: true });
  await sharp(master)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote ${path} (${size}x${size})`);
}
