"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { label: string; href: string }[] = [
    { label: "Decks", href: "/" },
  ];

  if (segments[0] === "decks" && segments[1]) {
    const deckName = decodeURIComponent(segments[1]);
    crumbs.push({
      label: deckName,
      href: `/decks/${segments[1]}`,
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
