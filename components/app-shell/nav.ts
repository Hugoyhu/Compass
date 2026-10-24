import { BookOpen, CalendarRange, GraduationCap, LayoutDashboard, ListChecks, NotebookPen, type LucideIcon } from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export const navItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, description: "Your degree at a glance" },
  { title: "My Courses", href: "/record", icon: NotebookPen, description: "Courses you've taken and are taking" },
  { title: "Course Explorer", href: "/courses", icon: BookOpen, description: "Search courses and prerequisites" },
  { title: "Degree Explorer", href: "/degrees", icon: GraduationCap, description: "Browse major and minor requirements" },
  { title: "Degree Progress", href: "/progress", icon: ListChecks, description: "Satisfied and outstanding requirements" },
  { title: "Semester Planner", href: "/planner", icon: CalendarRange, description: "Build your path to graduation" },
];

export function navItemFor(pathname: string): NavItem | undefined {
  return navItems.find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
}
