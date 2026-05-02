"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return <div className="h-5" />;

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
                href={crumb.href}
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
