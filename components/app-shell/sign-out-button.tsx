"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

/** Signs out, then does a full page load so nothing from the account stays on screen. */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOut();
          // A full load on purpose: the router would keep serving pages cached while signed in.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/");
        })
      }
    >
      <LogOut />
      Sign out
    </Button>
  );
}
