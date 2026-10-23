import Link from "next/link";
import { signOut } from "../login/actions";

const SECTIONS = [
  { href: "/admin", label: "Posts" },
  { href: "/admin/character", label: "Character" },
  { href: "/admin/articles", label: "Articles" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/jobs", label: "Jobs" },
] as const;

export type AdminSection = (typeof SECTIONS)[number]["href"];

/** Site header for every admin page: title, section links, sign out. */
export function AdminHeader({ current }: { current: AdminSection }) {
  return (
    <header>
      <h1>Humanity AI</h1>
      <nav aria-label="Admin sections">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} aria-current={s.href === current ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </header>
  );
}
