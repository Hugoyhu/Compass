import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { Suspense } from "react";
import { AccountMenu } from "@/components/app-shell/account-menu";
import { SiteHeader } from "@/components/app-shell/site-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const grotesk = Archivo({
  variable: "--font-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Compass", template: "%s · Compass" },
  description: "Prerequisite-aware degree audit and semester planning for Stony Brook students.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${grotesk.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider>
          <SiteHeader
            account={
              <Suspense fallback={null}>
                <AccountMenu />
              </Suspense>
            }
          />
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
