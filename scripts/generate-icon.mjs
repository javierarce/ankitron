import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const svgPath = resolve(root, "build/icon.svg");

const targets = [
  { path: "build/icon.png", size: 1024 },
  { path: "src/app/icon.png", size: 512 },
  { path: "public/apple-touch-icon.png", size: 180 },
];

const svg = await readFile(svgPath);

for (const { path, size } of targets) {
  const out = resolve(root, path);
  await mkdir(dirname(out), { recursive: true });
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote ${path} (${size}x${size})`);
}
