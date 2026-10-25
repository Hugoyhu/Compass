import Link from "next/link";
import { UserRound } from "lucide-react";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { accountsEnabled, getCurrentUser } from "@/lib/auth/session";

/** Header account control. Reads the session: render inside <Suspense>. */
export async function AccountMenu() {
  if (!accountsEnabled()) return null;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Sign in
        </Link>
        <Link href="/signup" className={buttonVariants({ size: "sm" })}>
          Create account
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="hidden items-center gap-1.5 px-2 text-sm sm:inline-flex">
        <UserRound className="size-4 text-muted-foreground" aria-hidden />
        {user.username}
      </span>
      <SignOutButton />
    </div>
  );
}
