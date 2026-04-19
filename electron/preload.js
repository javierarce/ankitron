// Runs before the renderer scripts in an isolated world, but can still mutate
// the DOM. We use it to tag <html> so CSS can target Electron and macOS
// specifically (e.g. padding to clear the traffic lights under hiddenInset).

const platform = process.platform;

function tagDocument() {
  document.documentElement.classList.add("electron");
  if (platform === "darwin") {
    document.documentElement.classList.add("electron-mac");
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", tagDocument, { once: true });
} else {
  tagDocument();
}
