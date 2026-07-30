describe("generateWithFallback", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PRIMARY_PROVIDER = "mock";
    process.env.AI_FALLBACK_PROVIDER = "mock";
  });

  it("uses the primary provider when it succeeds", async () => {
    process.env.AI_PRIMARY_PROVIDER = "mock";
    process.env.AI_FALLBACK_PROVIDER = "mock";
    jest.resetModules();
    const { generateWithFallback } = require("../../src/providers/registry");

    const outcome = await generateWithFallback("test_stage", { prompt: "hi" });
    expect(outcome.provider).toBe("mock");
    expect(outcome.usedFallback).toBe(false);
  });

  // Regression: getProvider() for the primary used to be called outside the
  // try/catch in generateWithFallback, so a *configuration* error (missing
  // API key) threw immediately instead of triggering fallback -- found live
  // during Sprint 3 verification (a real request 500'd instead of falling
  // back). This locks that fix in.
  it("falls back when the primary provider has no API key configured", async () => {
    process.env.AI_PRIMARY_PROVIDER = "openai";
    process.env.AI_FALLBACK_PROVIDER = "mock";
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();
    const { generateWithFallback } = require("../../src/providers/registry");

    const outcome = await generateWithFallback("test_stage", { prompt: "hi" });
    expect(outcome.provider).toBe("mock");
    expect(outcome.usedFallback).toBe(true);
  });

  it("throws a combined error when both primary and fallback fail", async () => {
    process.env.AI_PRIMARY_PROVIDER = "openai";
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    jest.resetModules();
    const { generateWithFallback } = require("../../src/providers/registry");

    await expect(generateWithFallback("test_stage", { prompt: "hi" })).rejects.toThrow(
      /both primary .* and fallback .* failed/
    );
  });

  it("does not attempt a fallback call when primary === fallback", async () => {
    process.env.AI_PRIMARY_PROVIDER = "openai";
    process.env.AI_FALLBACK_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();
    const { generateWithFallback } = require("../../src/providers/registry");

    await expect(generateWithFallback("test_stage", { prompt: "hi" })).rejects.toThrow(
      "OPENAI_API_KEY is not configured"
    );
  });
});
