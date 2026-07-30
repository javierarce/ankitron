// What's actually a *setting* of a deck, and nothing else. Renaming, moving,
// importing, exporting, and deleting are things you do to a deck, not ways to
// configure one; they live in the deck page's header (its title renames in
// place, its "⋮" menu holds the rest), leaving this page to the options.
//
// No heading either: the breadcrumb above already reads "Decks / … / Deutsch /
// Settings", naming both the deck and the page, with every level clickable — a
// title and a deck path under it would just say it twice.

import { useParams } from "react-router-dom";
import { DeckSettings } from "@/components/deck-settings";

export function DeckSettingsPage() {
  // React Router already URL-decodes path params; decoding again throws
  // URIError on any deck whose name contains a "%" and blanks the page.
  const { deckName: rawName } = useParams<{ deckName: string }>();
  const deckName = rawName!;

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="divide-y divide-border">
        <DeckSettings deckName={deckName} />
      </div>
    </div>
  );
}
