export { auth as middleware } from "@/lib/auth/config";

export const config = {
  matcher: [
    "/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.png|apple-icon.png|icons).*)",
  ],
};
