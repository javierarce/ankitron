import { Link, useLocation } from "react-router-dom";

export function Breadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  // Top-level pages already carry their own heading (the "All decks" / page
  // title below), so a single crumb would be redundant — render a spacer.
  // This also avoids seeding the "Decks" crumb on routes like /settings that
  // don't belong under Decks at all.
  if (
    segments.length === 0 ||
    (segments.length === 1 && (segments[0] === "decks" || segments[0] === "settings"))
  )
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
    } else if (segments[2] === "settings") {
      crumbs.push({
        label: "Settings",
        href: `/decks/${segments[1]}/settings`,
      });
    }
  }

  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.href} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="shrink-0 text-foreground/30">/</span>}
            {isLast ? (
              <span className="max-w-[16rem] truncate font-medium" title={crumb.label}>
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.href}
                title={crumb.label}
                className="max-w-[16rem] truncate text-foreground/50 hover:text-foreground transition-colors"
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
