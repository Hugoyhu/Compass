"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import compassLogo from "@/app/compasslogo.png";
import { cn } from "@/lib/utils";
import { navItemFor, navItems } from "./nav";

export function SiteHeader({ account }: { account: React.ReactNode }) {
  const active = navItemFor(usePathname());

  return (
    <header className="border-b-2 border-foreground">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-12 items-center gap-x-6 gap-y-3 px-4 py-4 md:px-8">
        <Link href="/" className="col-span-6 flex items-center gap-2 text-xl font-bold tracking-tight md:col-span-3">
          <Image src={compassLogo} alt="" width={18} height={33} className="h-7 w-auto object-contain" priority />
          Compass
        </Link>
        <div className="col-span-6 flex justify-end md:order-last md:col-span-2">{account}</div>
        <nav aria-label="Main" className="col-span-12 flex flex-wrap items-center gap-x-5 gap-y-1 text-base md:col-span-7">
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
