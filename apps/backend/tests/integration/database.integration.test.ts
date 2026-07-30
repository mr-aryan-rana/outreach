import { hasRealDatabase } from "./shouldRun";

const describeIfConfigured = hasRealDatabase() ? describe : describe.skip;

if (!hasRealDatabase()) {
   
  console.log(
    "[integration] Skipping database.integration.test.ts: set a real Supabase DATABASE_URL/DIRECT_URL in .env to run this."
  );
}

describeIfConfigured("Postgres (real Supabase instance)", () => {
  let prisma: import("@prisma/client").PrismaClient;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("can connect and run a trivial query", async () => {
    const result = await prisma.$queryRaw`SELECT 1 as one`;
    expect(result).toEqual([{ one: 1 }]);
  });

  it("enforces the unique constraint on Email.address", async () => {
    const suffix = Date.now();
    const creator = await prisma.creator.create({
      data: {
        handle: `@integration-test-${suffix}`,
        platform: "instagram",
        niche: "integration-test",
        emails: {
          create: {
            address: `integration-test-${suffix}@example.com`,
            sourceUrl: "https://example.com",
          },
        },
      },
    });

    await expect(
      prisma.email.create({
        data: {
          address: `integration-test-${suffix}@example.com`,
          sourceUrl: "https://example.com/other",
          creatorId: creator.id,
        },
      })
    ).rejects.toThrow();

    await prisma.email.deleteMany({ where: { creatorId: creator.id } });
    await prisma.creator.delete({ where: { id: creator.id } });
  });
});
