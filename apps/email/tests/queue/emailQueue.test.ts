const mockAdd = jest.fn().mockResolvedValue({ id: "job1" });

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockAdd, close: jest.fn() })),
}));

jest.mock("../../src/queue/connection", () => ({
  createQueueConnection: jest.fn(() => ({})),
}));

import { enqueueSend } from "../../src/queue/emailQueue";

describe("enqueueSend (requirement #2: retry, delay, priority)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes attempts and exponential backoff for retry", async () => {
    await enqueueSend("r1");
    const opts = mockAdd.mock.calls[0][2];
    expect(opts.attempts).toBe(3); // EMAIL_QUEUE_MAX_ATTEMPTS from tests/setupEnv.ts
    expect(opts.backoff).toEqual({ type: "exponential", delay: expect.any(Number) });
  });

  it("passes through a delay when given one", async () => {
    await enqueueSend("r1", { delayMs: 60_000 });
    const opts = mockAdd.mock.calls[0][2];
    expect(opts.delay).toBe(60_000);
  });

  it("passes through a priority when given one", async () => {
    await enqueueSend("r1", { priority: 5 });
    const opts = mockAdd.mock.calls[0][2];
    expect(opts.priority).toBe(5);
  });

  it("never auto-removes failed jobs -- they're explicitly moved to the DLQ instead", async () => {
    await enqueueSend("r1");
    const opts = mockAdd.mock.calls[0][2];
    expect(opts.removeOnFail).toBe(false);
  });
});
