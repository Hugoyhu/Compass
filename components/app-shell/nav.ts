export interface NavItem {
  title: string;
  href: string;
  /** Other sections the item covers, e.g. Catalog's Course Explorer. */
  also?: string[];
}

export const navItems: NavItem[] = [
  { title: "Dashboard", href: "/" },
  { title: "My Courses", href: "/record" },
  { title: "Catalog", href: "/degrees", also: ["/courses"] },
  { title: "Degree Progress", href: "/progress" },
  { title: "Semester Planner", href: "/plan" },
  { title: "Schedule Builder", href: "/planner" },
];

export function navItemFor(pathname: string): NavItem | undefined {
  // "/plan" is a prefix of "/planner", so match whole path segments.
  const within = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return navItems.find((item) => (item.href === "/" ? pathname === "/" : [item.href, ...(item.also ?? [])].some(within)));
}
