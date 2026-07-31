import { formatDateTime, formatDistanceToNow, formatPercent } from "@/lib/format";

describe("formatDistanceToNow", () => {
  it("returns 'just now' for very recent timestamps", () => {
    expect(formatDistanceToNow(new Date().toISOString())).toBe("just now");
  });

  it("returns minutes for timestamps under an hour old", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatDistanceToNow(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours for timestamps under a day old", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatDistanceToNow(threeHoursAgo)).toBe("3h ago");
  });

  it("returns 'unknown time' for an invalid date string", () => {
    expect(formatDistanceToNow("not-a-date")).toBe("unknown time");
  });
});

describe("formatDateTime", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("formats a valid ISO string", () => {
    const result = formatDateTime("2026-01-15T10:30:00.000Z");
    expect(result).not.toBe("—");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatPercent", () => {
  it("converts a 0-1 fraction to a percentage string", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0.0345)).toBe("3.5%");
  });
});
