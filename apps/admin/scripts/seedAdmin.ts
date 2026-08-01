/**
 * One-off: creates (or updates the password of) the first admin user from
 * ADMIN_SEED_EMAIL/ADMIN_SEED_NAME/ADMIN_SEED_PASSWORD. Safe to re-run --
 * upserts by email. Run with: npm run seed:admin
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL?.toLowerCase().trim();
  const name = process.env.ADMIN_SEED_NAME ?? "Admin";
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set");
  }
  if (password.length < 12) {
    throw new Error("ADMIN_SEED_PASSWORD must be at least 12 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.adminUser.upsert({
    where: { email },
    create: { email, name, passwordHash, role: "admin" },
    update: { passwordHash, name, isActive: true },
  });

  console.log(`Seeded admin user: ${user.email} (role: ${user.role})`);
}

main()
  .catch((err) => {
    console.error("ERROR:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
