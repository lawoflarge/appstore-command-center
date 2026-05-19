import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { env } from "@/env";

export function isAllowed(profile: { login?: string } | null, allowed: string): boolean {
  return !!profile?.login && profile.login === allowed;
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const e = env();
  return {
    providers: [GitHub({
      clientId: e.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: e.GITHUB_OAUTH_CLIENT_SECRET,
    })],
    secret: e.AUTH_SECRET,
    callbacks: {
      signIn({ profile }) { return isAllowed(profile as { login?: string } | null, e.ALLOWED_GITHUB_LOGIN); },
      authorized({ auth }) { return !!auth?.user; },
    },
  };
});
