// Pre-registers every prompt file's every version into prompt_templates/
// prompt_versions. Not required for the pipeline to work (resolveAndRenderPrompt
// registers lazily on first use), but useful for ops: run this after adding
// a new prompt version so it shows up in the DB before the first real request.
import { prisma } from "../db";
import { listPromptNames, loadPromptVersions } from "./promptLoader";

async function main(): Promise<void> {
  const names = listPromptNames();
  for (const name of names) {
    const versions = loadPromptVersions(name);
    const template = await prisma.promptTemplate.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    for (const v of versions) {
      await prisma.promptVersion.upsert({
        where: { templateId_version: { templateId: template.id, version: v.version } },
        create: { templateId: template.id, version: v.version, content: v.content, variables: v.variables },
        update: { content: v.content, variables: v.variables },
      });
       
      console.log(`registered ${name} v${v.version}`);
    }
  }
}

main()
  .catch((err) => {
     
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
