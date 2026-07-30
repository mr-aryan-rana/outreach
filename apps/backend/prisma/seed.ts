import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const creator = await prisma.creator.upsert({
    where: { handle_platform: { handle: "@thequistfamily", platform: "instagram" } },
    update: {},
    create: {
      handle: "@thequistfamily",
      platform: "instagram",
      niche: "couple vlog",
      websiteUrl: "https://linktr.ee/TheQuistFamily",
      instagram: "https://instagram.com/thequistfamily",
      emails: {
        create: {
          address: "courtneyandalexquist@gmail.com",
          sourceUrl: "https://instagram.com/thequistfamily",
          validationResult: {
            create: {
              isValid: true,
              confidenceScore: 1.0,
              reasons: ["syntax_ok", "not_disposable", "mx_ok"],
            },
          },
        },
      },
    },
  });

  console.log(`Seeded creator ${creator.handle}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
