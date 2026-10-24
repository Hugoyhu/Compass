import { BookOpen, CalendarRange, GraduationCap, LayoutDashboard, ListChecks, NotebookPen, type LucideIcon } from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "My Courses", href: "/record", icon: NotebookPen },
  { title: "Degree Explorer", href: "/degrees", icon: GraduationCap },
  { title: "Course Explorer", href: "/courses", icon: BookOpen },
  { title: "Degree Progress", href: "/progress", icon: ListChecks },
  { title: "Semester Planner", href: "/planner", icon: CalendarRange },
];

export function navItemFor(pathname: string): NavItem | undefined {
  return navItems.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
}
