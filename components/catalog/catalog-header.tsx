import Link from "next/link";

const TABS = [
  { title: "Degree Explorer", href: "/degrees" },
  { title: "Course Explorer", href: "/courses" },
] as const;

/** The Catalog heading with its two explorers as tabs. */
export function CatalogHeader({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <div className="space-y-6">
      <h2 className="text-5xl font-bold tracking-tight md:text-6xl">Catalog</h2>
      <nav aria-label="Catalog" className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.href === active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab.href === active ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab.title}
          </Link>
        ))}
      </nav>
    </div>
  );
}
