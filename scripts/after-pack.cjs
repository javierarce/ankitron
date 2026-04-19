// electron-builder hook: runs after the app is packed but before code signing.
// We use it to copy the staged node_modules into <Resources>/standalone —
// electron-builder's default file-matcher filters node_modules out of
// extraResources, so we inject it ourselves.

const { cp } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const projectDir = packager.projectDir;

  const productName = packager.appInfo.productFilename;
  const resourcesDir =
    process.platform === "darwin"
      ? join(appOutDir, `${productName}.app`, "Contents", "Resources")
      : join(appOutDir, "resources");

  const src = join(projectDir, ".electron-stage/standalone/node_modules");
  const dest = join(resourcesDir, "standalone/node_modules");

  await cp(src, dest, { recursive: true });
  console.log(`afterPack: copied node_modules into ${dest}`);
};
