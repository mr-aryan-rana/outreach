const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const c = await prisma.creator.create({
    data: { handle: "@loadtest", platform: "instagram", niche: "loadtest", websiteUrl: "https://example.com/loadtest", bio: "Load test creator.", socialLinks: [] },
  });
  console.log(c.id);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
