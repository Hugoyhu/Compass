import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { accountsEnabled, getCurrentUser } from "@/lib/auth/session";
import { readGuestRecord } from "@/lib/student/guest-records";
import { AuthForm } from "./auth-form";

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
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
        <AlertDescription>Your courses are saved in this browser.</AlertDescription>
      </Alert>
    );
  }
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode={mode} hasGuestRecord={(await readGuestRecord()) !== null} />;
}
