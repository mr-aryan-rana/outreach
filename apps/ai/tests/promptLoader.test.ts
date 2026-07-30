import { listPromptNames, loadLatestPromptVersion, loadPromptVersions, renderPrompt } from "../src/prompts/promptLoader";

const EXPECTED_PROMPTS = [
  "creator-summary",
  "brand-analysis",
  "creator-analysis",
  "brand-fit-score",
  "subject-generation",
  "email-draft",
  "quality-review",
];

describe("prompt files (regression)", () => {
  it("has exactly the 7 prompts the pipeline depends on", () => {
    expect(listPromptNames().sort()).toEqual(EXPECTED_PROMPTS.slice().sort());
  });

  it.each(EXPECTED_PROMPTS)("%s v1 parses with a non-empty variable list and content", (name) => {
    const loaded = loadLatestPromptVersion(name);
    expect(loaded.version).toBeGreaterThanOrEqual(1);
    expect(loaded.variables.length).toBeGreaterThan(0);
    expect(loaded.content.length).toBeGreaterThan(0);
    // Never hardcode a prompt in code -- requirement #3. This is the closest
    // thing to a regression guard against that: every {{variable}} the
    // content actually references must be declared in the header line, so a
    // typo'd or newly-added placeholder can't silently go unrendered.
    const referencedVars = [...loaded.content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const ref of referencedVars) {
      expect(loaded.variables).toContain(ref);
    }
  });

  it("versions within a prompt are sorted ascending and unique", () => {
    for (const name of EXPECTED_PROMPTS) {
      const versions = loadPromptVersions(name).map((v) => v.version);
      const sorted = [...versions].sort((a, b) => a - b);
      expect(versions).toEqual(sorted);
      expect(new Set(versions).size).toBe(versions.length);
    }
  });

  it("renders {{variable}} placeholders with provided values", () => {
    const rendered = renderPrompt("Hello {{name}}, you are in {{niche}}.", {
      name: "Alex",
      niche: "cooking",
    });
    expect(rendered).toBe("Hello Alex, you are in cooking.");
  });

  it("marks missing variables explicitly instead of silently blanking them", () => {
    const rendered = renderPrompt("Hello {{name}}!", {});
    expect(rendered).toBe("Hello [[MISSING_VARIABLE:name]]!");
  });

  it("throws a clear error for an unknown prompt name", () => {
    expect(() => loadLatestPromptVersion("does-not-exist")).toThrow(/No prompt directory found/);
  });
});
