import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarStudent, SidebarStudentSkeleton } from "@/components/app-shell/sidebar-student";
import { SiteHeader } from "@/components/app-shell/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getRepository } from "@/lib/data/repository";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Compass", template: "%s · Compass" },
  description: "Prerequisite-aware degree audit and semester planning for Stony Brook students.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const source = await getRepository().source();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
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
              <SiteHeader sourceLabel={source.label} disclaimer={source.disclaimer} />
              {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
