import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./layout";
import { HomePage } from "./pages/home";
import { DecksPage } from "./pages/decks";
import { DeckDetailPage } from "./pages/deck-detail";
import { DeckSettingsPage } from "./pages/deck-settings";
import { StudyRoute } from "./pages/study";
import { SettingsPage } from "./pages/settings";
import { StatsPage } from "./pages/stats";
import { ThemeProvider } from "./lib/theme";
import { UpdateProvider } from "./components/update-provider";
import { ToastProvider } from "./components/toast-provider";
import "./app/globals.css";

// The marketing demo is served as static files from a subpath (/demo/). The app
// hard-reloads after some actions (e.g. dismissing an import result); with
// history routing that reload requests a deep URL like /demo/decks/Foo, which
// the static host has no file for (nginx 404). Hash routing keeps the served
// path at /demo/index.html so a reload always resolves and the user stays put.
// The real (Tauri) app keeps history routing.
const isDemo = Boolean(import.meta.env.VITE_DEMO);

// The demo is framed by a fake macOS window whose traffic lights overlay the
// app header, exactly like the real hidden-inset title bar. Reuse the same
// class so the header nav clears the cluster (see .tauri-mac in globals.css);
// the Tauri-only behaviour lives behind the separate `tauri` class.
if (isDemo) {
  document.documentElement.classList.add("tauri-mac");
}

const routes = (
  <Routes>
    <Route element={<Layout />}>
      <Route index element={<HomePage />} />
      <Route path="decks" element={<DecksPage />} />
      <Route path="decks/:deckName" element={<DeckDetailPage />} />
      <Route path="decks/:deckName/settings" element={<DeckSettingsPage />} />
      <Route path="decks/:deckName/study" element={<StudyRoute />} />
      <Route path="stats" element={<StatsPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
  </Routes>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <UpdateProvider>
        <ToastProvider>
          {isDemo ? (
            <HashRouter>{routes}</HashRouter>
          ) : (
            <BrowserRouter basename={import.meta.env.BASE_URL}>{routes}</BrowserRouter>
          )}
        </ToastProvider>
      </UpdateProvider>
    </ThemeProvider>
  </StrictMode>,
);
