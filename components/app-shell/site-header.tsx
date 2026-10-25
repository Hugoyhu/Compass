"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import compassLogo from "@/app/compasslogo.png";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";
import { navItemFor, navItems } from "./nav";

export function SiteHeader({ account }: { account: React.ReactNode }) {
  const active = navItemFor(usePathname());

  return (
    <header className="border-b-2 border-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 md:flex-nowrap md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-bold tracking-tight">
          <Image src={compassLogo} alt="" width={18} height={33} className="h-7 w-auto object-contain dark:invert" priority />
          Compass
        </Link>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1 md:order-last md:ml-0">
          <ThemeToggle />
          {account}
        </div>
        <nav aria-label="Main" className="flex min-w-0 basis-full flex-wrap items-center gap-x-5 gap-y-1 text-base md:basis-auto md:flex-1 md:flex-nowrap md:justify-center md:overflow-x-auto md:whitespace-nowrap">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active?.href === item.href ? "page" : undefined}
              className={cn(
                "font-medium text-muted-foreground hover:text-foreground",
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
