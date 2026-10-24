import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { accountsEnabled, getCurrentUser } from "@/lib/auth/session";
import { readGuestRecord } from "@/lib/student/guest-records";
import { AuthForm } from "./auth-form";

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <main className="flex w-full flex-1 items-start justify-center p-4 pt-12 md:p-6 md:pt-20">
      <Suspense fallback={<Skeleton className="h-80 w-full max-w-sm" />}>
        <AuthContent mode={mode} />
      </Suspense>
    </main>
  );
}

async function AuthContent({ mode }: { mode: "sign-in" | "sign-up" }) {
  if (!accountsEnabled()) {
    return (
      <Alert className="max-w-md">
        <AlertTitle>Accounts aren&apos;t available</AlertTitle>
        <AlertDescription>This server has no database configured. Your courses are saved in this browser instead.</AlertDescription>
      </Alert>
    );
  }
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode={mode} hasGuestRecord={(await readGuestRecord()) !== null} />;
}
