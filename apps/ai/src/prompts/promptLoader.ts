import fs from "fs";
import path from "path";

export interface LoadedPrompt {
  name: string;
  version: number;
  content: string;
  variables: string[];
}

const PROMPTS_DIR = path.join(__dirname, "..", "..", "prompts");
const FILE_PATTERN = /^v(\d+)\.md$/;

/**
 * Prompts live as files (prompts/<name>/v<N>.md), never as inline strings in
 * code -- requirement #3. First line is `variables: a, b, c`; the rest of
 * the file (after the blank line) is the template text with {{variable}}
 * placeholders. This tiny format (not YAML front-matter) is deliberate:
 * avoids pulling in a YAML parser for a one-line variable list.
 */
function parsePromptFile(raw: string): { content: string; variables: string[] } {
  const lines = raw.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  const match = firstLine.match(/^variables:\s*(.*)$/);
  if (!match) {
    throw new Error(`Prompt file must start with "variables: a, b, c" -- got: "${firstLine}"`);
  }
  const variables = match[1]
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  // Skip the variables line and one blank separator line, keep the rest verbatim.
  const rest = lines.slice(1);
  while (rest.length > 0 && rest[0].trim() === "") rest.shift();
  const content = rest.join("\n").trimEnd();

  return { content, variables };
}

/** Loads every version file for one prompt name (e.g. "creator-summary"). */
export function loadPromptVersions(name: string): LoadedPrompt[] {
  const dir = path.join(PROMPTS_DIR, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`No prompt directory found for "${name}" (expected ${dir})`);
  }
  const files = fs.readdirSync(dir).filter((f) => FILE_PATTERN.test(f));
  if (files.length === 0) {
    throw new Error(`No version files found for prompt "${name}" in ${dir}`);
  }

  return files
    .map((file) => {
      const version = Number(file.match(FILE_PATTERN)![1]);
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { content, variables } = parsePromptFile(raw);
      return { name, version, content, variables };
    })
    .sort((a, b) => a.version - b.version);
}

/** The highest-numbered version file is always "latest" -- no separate deprecation flag in the file system, that's tracked in prompt_versions.isActive instead. */
export function loadLatestPromptVersion(name: string): LoadedPrompt {
  const versions = loadPromptVersions(name);
  return versions[versions.length - 1];
}

export function listPromptNames(): string[] {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs.readdirSync(PROMPTS_DIR).filter((entry) => fs.statSync(path.join(PROMPTS_DIR, entry)).isDirectory());
}

/** Fills {{variable}} placeholders. Missing variables are left as an explicit marker rather than silently blank, so a wiring bug is obvious in the rendered prompt instead of silently producing a worse LLM response. */
export function renderPrompt(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!(key in variables)) return `[[MISSING_VARIABLE:${key}]]`;
    return variables[key];
  });
}
