"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navItemFor, navItems } from "./nav";

export function SiteHeader({ account }: { account: React.ReactNode }) {
  const active = navItemFor(usePathname());

  return (
    <header className="border-b-2 border-foreground">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-12 items-baseline gap-x-6 gap-y-3 px-4 py-4 md:px-8">
        <Link href="/" className="col-span-6 text-xl font-bold tracking-tight md:col-span-3">
          Compass
        </Link>
        <div className="col-span-6 flex justify-end md:order-last md:col-span-2">{account}</div>
        <nav aria-label="Main" className="col-span-12 flex flex-wrap gap-x-5 gap-y-1 text-sm md:col-span-7">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active?.href === item.href ? "page" : undefined}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                active?.href === item.href && "font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-[6px]",
              )}
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
