import { MockProvider } from "../../src/providers/mock";

describe("MockProvider", () => {
  it("is deterministic for the same prompt", async () => {
    const provider = new MockProvider();
    const a = await provider.generate({ prompt: "hello world" });
    const b = await provider.generate({ prompt: "hello world" });
    expect(a.text).toBe(b.text);
  });

  it("produces different output for different prompts", async () => {
    const provider = new MockProvider();
    const a = await provider.generate({ prompt: "prompt one" });
    const b = await provider.generate({ prompt: "prompt two" });
    expect(a.text).not.toBe(b.text);
  });

  it("reports token usage without making any network call", async () => {
    const provider = new MockProvider();
    const result = await provider.generate({ prompt: "a reasonably long prompt for token estimation" });
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.promptTokens! + result.completionTokens!);
    expect(result.model).toBe("mock");
  });
});
