import type { NextAuthConfig } from "next-auth";
import { isRole, type Role } from "./rbac";

/**
 * Edge-safe subset of the Auth.js config -- no Credentials provider here
 * (it pulls in bcryptjs + Prisma, neither of which run in the Edge runtime
 * that middleware.ts executes in). middleware.ts only needs to read an
 * already-issued JWT session, never call `authorize()` itself -- that only
 * happens inside the /api/auth/[...nextauth] route handler, which runs in
 * the Node.js runtime and uses the full config in auth.ts.
 */
export default {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.role = (user as { role: string }).role;
        token.id = user.id;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = isRole(token.role) ? (token.role as Role) : "readonly";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
