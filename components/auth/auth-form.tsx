"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { signIn, signUp, type AuthState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function AuthForm({ mode, hasGuestRecord }: { mode: "sign-in" | "sign-up"; hasGuestRecord: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "sign-in" ? signIn : signUp, {});
  const signingUp = mode === "sign-up";

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">{signingUp ? "Create an account" : "Sign in"}</CardTitle>
        {hasGuestRecord && <CardDescription>Courses saved in this browser will move to your account.</CardDescription>}
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4">
          <input type="hidden" name="next" value="/" />
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Username</span>
            <Input
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              defaultValue={state.username}
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Password</span>
            <Input
              name="password"
              type="password"
              autoComplete={signingUp ? "new-password" : "current-password"}
              required
              minLength={signingUp ? 8 : undefined}
              maxLength={200}
            />
          </label>
          {signingUp && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">Confirm password</span>
              <Input name="confirm" type="password" autoComplete="new-password" required maxLength={200} />
              <span className="block text-xs text-muted-foreground">There&apos;s no password reset.</span>
            </label>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-4 flex-col items-stretch gap-3 py-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {signingUp ? "Create account" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {signingUp ? "Have an account? " : "No account? "}
            <Link href={signingUp ? "/login" : "/signup"} className="font-medium text-foreground underline-offset-4 hover:underline">
              {signingUp ? "Sign in" : "Create one"}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
