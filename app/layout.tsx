import type { Metadata } from "next";
import { IBM_Plex_Mono, Source_Serif_4 } from "next/font/google";
import { Suspense } from "react";
import { AccountMenu } from "@/components/app-shell/account-menu";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarStudent, SidebarStudentSkeleton } from "@/components/app-shell/sidebar-student";
import { SiteHeader } from "@/components/app-shell/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "Compass", template: "%s · Compass" },
  description: "Prerequisite-aware degree audit and semester planning for Stony Brook students.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              footer={
                <Suspense fallback={<SidebarStudentSkeleton />}>
                  <SidebarStudent />
                </Suspense>
              }
            />
            <SidebarInset>
              <SiteHeader
                account={
                  <Suspense fallback={null}>
                    <AccountMenu />
                  </Suspense>
                }
              />
              {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
