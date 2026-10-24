import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/auth-page";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <AuthPage mode="sign-in" />;
}
