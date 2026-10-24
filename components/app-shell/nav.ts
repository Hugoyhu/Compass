export interface NavItem {
  title: string;
  href: string;
}

export const navItems: NavItem[] = [
  { title: "Dashboard", href: "/" },
  { title: "My Courses", href: "/record" },
  { title: "Degree Explorer", href: "/degrees" },
  { title: "Course Explorer", href: "/courses" },
  { title: "Degree Progress", href: "/progress" },
  { title: "Schedule Builder", href: "/planner" },
];

export function navItemFor(pathname: string): NavItem | undefined {
  return navItems.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
}
