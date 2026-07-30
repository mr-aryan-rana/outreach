import { prisma } from "../db";
import { loadLatestPromptVersion, renderPrompt } from "./promptLoader";

export interface ResolvedPrompt {
  promptVersionId: string;
  rendered: string;
  missingVariables: string[];
}

/**
 * Ensures the file-authored prompt (requirement #3: files are the source of
 * truth) has a matching row in prompt_templates/prompt_versions (requirement
 * #5: DB tracks which version exists), then renders it with the given
 * variables. Idempotent -- safe to call on every request; the upsert is a
 * no-op once a version's row already exists.
 */
export async function resolveAndRenderPrompt(
  name: string,
  variables: Record<string, string>
): Promise<ResolvedPrompt> {
  const loaded = loadLatestPromptVersion(name);

  const template = await prisma.promptTemplate.upsert({
    where: { name },
    create: { name },
    update: {},
  });

  const promptVersion = await prisma.promptVersion.upsert({
    where: { templateId_version: { templateId: template.id, version: loaded.version } },
    create: {
      templateId: template.id,
      version: loaded.version,
      content: loaded.content,
      variables: loaded.variables,
    },
    // Content is file-controlled, not DB-controlled -- if the file changed
    // without bumping the version number (a mistake, not a supported flow),
    // re-sync the DB copy so audits reflect what actually ran, rather than a
    // stale first-seen copy.
    update: { content: loaded.content, variables: loaded.variables },
  });

  const providedKeys = new Set(Object.keys(variables));
  const missingVariables = loaded.variables.filter((v) => !providedKeys.has(v));

  return {
    promptVersionId: promptVersion.id,
    rendered: renderPrompt(loaded.content, variables),
    missingVariables,
  };
}
