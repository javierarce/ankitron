import { Link, useLocation } from "react-router-dom";

export function Breadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  // On the decks index the crumb would just say "Decks", which is redundant
  // with the header nav and the "All decks" heading below — render a spacer.
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "decks"))
    return <div className="h-5" />;

  const crumbs: { label: string; href: string }[] = [
    { label: "Decks", href: "/decks" },
  ];

  if (segments[0] === "decks" && segments[1]) {
    const deckName = decodeURIComponent(segments[1]);
    const parts = deckName.split("::");

    parts.forEach((part, i) => {
      const fullName = parts.slice(0, i + 1).join("::");
      crumbs.push({
        label: part,
        href: `/decks/${encodeURIComponent(fullName)}`,
      });
    });

    if (segments[2] === "study") {
      crumbs.push({
        label: "Study",
        href: `/decks/${segments[1]}/study`,
      });
    }
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.href} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-foreground/30">/</span>}
            {isLast ? (
              <span className="font-medium">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.href}
                className="text-foreground/50 hover:text-foreground transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
