import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./layout";
import { HomePage } from "./pages/home";
import { DecksPage } from "./pages/decks";
import { DeckDetailPage } from "./pages/deck-detail";
import { StudyPage } from "./pages/study";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="decks" element={<DecksPage />} />
          <Route path="decks/:deckName" element={<DeckDetailPage />} />
          <Route path="decks/:deckName/study" element={<StudyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
