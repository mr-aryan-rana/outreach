import RedisMock from "ioredis-mock";
import { DuplicateChecker } from "../src/services/duplicateCheck";

describe("DuplicateChecker", () => {
  it("reports no duplicate before an email is marked seen", async () => {
    const checker = new DuplicateChecker(new RedisMock() as any);
    expect(await checker.isDuplicateEmail("a@example.com")).toBe(false);
  });

  it("reports a duplicate after the same email is marked seen once", async () => {
    const checker = new DuplicateChecker(new RedisMock() as any);
    await checker.markEmailSeen("a@example.com");
    expect(await checker.isDuplicateEmail("a@example.com")).toBe(true);
  });

  it("treats emails as case-insensitive", async () => {
    const checker = new DuplicateChecker(new RedisMock() as any);
    await checker.markEmailSeen("A@Example.com");
    expect(await checker.isDuplicateEmail("a@example.com")).toBe(true);
  });

  it("tracks website duplicates by full URL, not just hostname", async () => {
    const checker = new DuplicateChecker(new RedisMock() as any);
    await checker.markWebsiteSeen("https://instagram.com/foo");
    expect(await checker.isDuplicateWebsite("https://instagram.com/foo")).toBe(true);
    // Regression: instagram.com/youtube.com/tiktok.com share one hostname per
    // platform, so a different creator on the same platform must NOT be
    // treated as a duplicate just because they share a hostname.
    expect(await checker.isDuplicateWebsite("https://instagram.com/bar")).toBe(false);
    expect(await checker.isDuplicateWebsite("https://tiktok.com/foo")).toBe(false);
  });

  it("ignores a trailing slash when comparing the same URL", async () => {
    const checker = new DuplicateChecker(new RedisMock() as any);
    await checker.markWebsiteSeen("https://instagram.com/foo/");
    expect(await checker.isDuplicateWebsite("https://instagram.com/foo")).toBe(true);
  });
});
