import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth.config";

// Edge-safe config only (no Credentials/Prisma/bcrypt -- see auth.config.ts)
// -- middleware runs in the Edge runtime and only needs to read an
// already-issued JWT session cookie, never call authorize() itself.
const { auth } = NextAuth(authConfig);

/**
 * Protects every page and every /api/proxy/* call -- this is the actual
 * enforcement point for "must be logged in," not just a client-side redirect
 * (a client component can be bypassed by calling the proxy route directly;
 * this middleware runs before that route handler regardless). Role-specific
 * permission checks happen one layer deeper, inside each proxy route
 * handler (src/lib/rbac.ts, src/lib/permissionForRequest.ts) -- this layer
 * only asks "is there a valid session at all."
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");

  if (!req.auth && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (req.auth && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
