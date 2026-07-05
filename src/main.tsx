import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./layout";
import { HomePage } from "./pages/home";
import { DecksPage } from "./pages/decks";
import { DeckDetailPage } from "./pages/deck-detail";
import { DeckSettingsPage } from "./pages/deck-settings";
import { StudyPage } from "./pages/study";
import { SettingsPage } from "./pages/settings";
import { ThemeProvider } from "./lib/theme";
import { UpdateProvider } from "./components/update-provider";
import { ToastProvider } from "./components/toast-provider";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <UpdateProvider>
        <ToastProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="decks" element={<DecksPage />} />
                <Route path="decks/:deckName" element={<DeckDetailPage />} />
                <Route path="decks/:deckName/settings" element={<DeckSettingsPage />} />
                <Route path="decks/:deckName/study" element={<StudyPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </UpdateProvider>
    </ThemeProvider>
  </StrictMode>,
);
