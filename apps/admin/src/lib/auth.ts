import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import authConfig from "./auth.config";
import { adminDb } from "./adminDb";
import { isRole } from "./rbac";

/**
 * Full config (Node.js runtime only -- used by the /api/auth route handler
 * and every server-side `auth()` call outside middleware). Extends the
 * edge-safe base config with the actual Credentials provider, which needs
 * Prisma + bcrypt. See auth.config.ts for why this split exists.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email.toLowerCase().trim() : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        const user = await adminDb.adminUser.findUnique({ where: { email } });
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, role: isRole(user.role) ? user.role : "readonly" };
      },
    }),
  ],
});
