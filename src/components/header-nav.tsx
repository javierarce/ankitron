import { Link, useLocation } from "react-router-dom";

export function HeaderNav() {
  const { pathname } = useLocation();
  const isStudy = pathname === "/";
  const isDecks = pathname === "/decks" || pathname.startsWith("/decks/");

  return (
    <nav className="flex items-center gap-5 text-sm">
      <NavLink href="/" active={isStudy}>
        Study
      </NavLink>
      <NavLink href="/decks" active={isDecks}>
        Decks
      </NavLink>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={href}
      className={`transition-colors ${
        active
          ? "text-foreground font-medium"
          : "text-foreground/50 hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
