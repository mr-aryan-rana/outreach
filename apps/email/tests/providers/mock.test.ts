import { MockEmailProvider } from "../../src/providers/mock";

describe("MockEmailProvider", () => {
  it("never makes a network call and returns a fake message id", async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      to: "creator@example.com",
      from: "brand@makeable.test",
      subject: "Hi",
      body: "Hello there",
    });
    expect(result.providerMessageId).toMatch(/^mock-/);
  });

  it("produces a unique message id per call", async () => {
    const provider = new MockEmailProvider();
    const a = await provider.send({ to: "a@example.com", from: "x@y.com", subject: "s", body: "b" });
    const b = await provider.send({ to: "a@example.com", from: "x@y.com", subject: "s", body: "b" });
    expect(a.providerMessageId).not.toBe(b.providerMessageId);
  });
});
