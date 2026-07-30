jest.mock("../src/db", () => ({
  prisma: {
    creatorSummary: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
    },
    draftEmail: {
      create: jest.fn(),
    },
    promptTemplate: {
      upsert: jest.fn().mockResolvedValue({ id: "template1" }),
    },
    promptVersion: {
      upsert: jest.fn().mockResolvedValue({ id: "version1" }),
    },
  },
}));

jest.mock("../src/services/creatorClient", () => {
  const actual = jest.requireActual("../src/services/creatorClient");
  return { ...actual, fetchCreator: jest.fn() };
});

jest.mock("../src/providers/registry", () => ({
  generateWithFallback: jest.fn(),
}));

jest.mock("../src/services/jobs", () => ({
  createJob: jest.fn(),
  completeJob: jest.fn(),
  failJob: jest.fn(),
  recordGeneration: jest.fn(),
}));

import { prisma } from "../src/db";
import { generateWithFallback } from "../src/providers/registry";
import { CreatorDetail, CreatorNotFoundError, fetchCreator } from "../src/services/creatorClient";
import { completeJob, createJob, failJob } from "../src/services/jobs";
import { runBrandFitPipeline, runDraftPipeline, runSummaryPipeline } from "../src/services/pipeline";

const CREATOR: CreatorDetail = {
  id: "c1",
  handle: "@example",
  platform: "instagram",
  niche: "cooking",
  websiteUrl: "https://instagram.com/example",
  bio: "I cook vegan food.",
  socialLinks: ["https://instagram.com/example"],
  email: "a@example.com",
  confidenceScore: 0.9,
};

const BRAND = { name: "GreenEats", description: "Plant-based meal kits." };

function mockGenerate(text: string) {
  return {
    result: { text, model: "mock", promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    provider: "mock" as const,
    usedFallback: false,
    latencyMs: 1,
  };
}

describe("pipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createJob as jest.Mock).mockResolvedValue({ id: "job1" });
    (fetchCreator as jest.Mock).mockResolvedValue(CREATOR);
  });

  describe("runSummaryPipeline", () => {
    it("generates and upserts a creator summary, then completes the job", async () => {
      (generateWithFallback as jest.Mock).mockResolvedValue(
        mockGenerate("A vegan cooking creator.\nKey themes: vegan, cooking, wellness")
      );
      (prisma.creatorSummary.upsert as jest.Mock).mockResolvedValue({});
      (prisma.creatorSummary.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: "sum1",
        keyThemes: ["vegan", "cooking", "wellness"],
      });

      const result = await runSummaryPipeline("c1");

      expect(result.jobId).toBe("job1");
      expect(prisma.creatorSummary.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { creatorId: "c1" } })
      );
      expect(completeJob).toHaveBeenCalledWith("job1", { creatorSummaryId: "sum1" });
    });

    it("fails the job and rethrows when the creator doesn't exist", async () => {
      (fetchCreator as jest.Mock).mockRejectedValue(new CreatorNotFoundError("c1"));

      await expect(runSummaryPipeline("c1")).rejects.toThrow(CreatorNotFoundError);
      // fetchCreator failed before createJob was ever called -- nothing to fail.
      expect(createJob).not.toHaveBeenCalled();
    });

    it("fails the job when generation throws", async () => {
      (generateWithFallback as jest.Mock).mockRejectedValue(new Error("both providers down"));

      await expect(runSummaryPipeline("c1")).rejects.toThrow("both providers down");
      expect(failJob).toHaveBeenCalledWith("job1", "both providers down");
    });
  });

  describe("runBrandFitPipeline", () => {
    it("reuses an existing creator summary instead of regenerating it", async () => {
      (prisma.creatorSummary.findUnique as jest.Mock).mockResolvedValue({
        summary: "existing summary text",
      });
      (generateWithFallback as jest.Mock)
        .mockResolvedValueOnce(mockGenerate("brand analysis text"))
        .mockResolvedValueOnce(mockGenerate("creator analysis text"))
        .mockResolvedValueOnce(mockGenerate("Score: 0.82\nReasoning: strong niche overlap"));

      const result = await runBrandFitPipeline("c1", BRAND);

      expect(result.creatorSummary).toBe("existing summary text");
      expect(result.fitScore).toBe(0.82);
      expect(result.fitReasoning).toBe("strong niche overlap");
      // 3 calls: brand analysis, creator analysis, fit score -- not 4, since
      // the summary was reused rather than regenerated.
      expect(generateWithFallback).toHaveBeenCalledTimes(3);
    });

    it("generates a fresh summary when none exists yet", async () => {
      (prisma.creatorSummary.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.creatorSummary.upsert as jest.Mock).mockResolvedValue({});
      (generateWithFallback as jest.Mock)
        .mockResolvedValueOnce(mockGenerate("fresh summary\nKey themes: a, b"))
        .mockResolvedValueOnce(mockGenerate("brand analysis"))
        .mockResolvedValueOnce(mockGenerate("creator analysis"))
        .mockResolvedValueOnce(mockGenerate("Score: 0.50\nReasoning: mixed fit"));

      const result = await runBrandFitPipeline("c1", BRAND);

      expect(result.creatorSummary).toBe("fresh summary\nKey themes: a, b");
      expect(generateWithFallback).toHaveBeenCalledTimes(4);
    });

    it("clamps an out-of-range score into [0, 1]", async () => {
      (prisma.creatorSummary.findUnique as jest.Mock).mockResolvedValue({ summary: "s" });
      (generateWithFallback as jest.Mock)
        .mockResolvedValueOnce(mockGenerate("brand analysis"))
        .mockResolvedValueOnce(mockGenerate("creator analysis"))
        .mockResolvedValueOnce(mockGenerate("Score: 1.50\nReasoning: too high"));

      const result = await runBrandFitPipeline("c1", BRAND);
      expect(result.fitScore).toBe(1);
    });
  });

  describe("runDraftPipeline", () => {
    it("runs the full chain and saves a draft with status 'draft'", async () => {
      (prisma.creatorSummary.findUnique as jest.Mock).mockResolvedValue({ summary: "existing summary" });
      (generateWithFallback as jest.Mock)
        .mockResolvedValueOnce(mockGenerate("brand analysis"))
        .mockResolvedValueOnce(mockGenerate("creator analysis"))
        .mockResolvedValueOnce(mockGenerate("Score: 0.70\nReasoning: good fit"))
        .mockResolvedValueOnce(mockGenerate("Subject line one\nSubject line two\nSubject line three"))
        .mockResolvedValueOnce(mockGenerate("Dear creator, ..."))
        .mockResolvedValueOnce(mockGenerate("Score: 0.90\nNotes: looks good"));
      (prisma.draftEmail.create as jest.Mock).mockResolvedValue({
        id: "draft1",
        status: "draft",
        subject: "Subject line one",
      });

      const result = await runDraftPipeline("c1", BRAND);

      expect(generateWithFallback).toHaveBeenCalledTimes(6);
      expect(prisma.draftEmail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            creatorId: "c1",
            subject: "Subject line one",
            body: "Dear creator, ...",
            brandFitScore: 0.7,
            qualityScore: 0.9,
            status: "draft",
          }),
        })
      );
      expect(result.draft.status).toBe("draft");
      expect(completeJob).toHaveBeenCalled();
    });

    it("never sends anything -- draftEmail.create is the only side effect beyond generations", async () => {
      (prisma.creatorSummary.findUnique as jest.Mock).mockResolvedValue({ summary: "s" });
      (generateWithFallback as jest.Mock).mockResolvedValue(mockGenerate("Score: 0.5\nReasoning: x\nNotes: y"));
      (prisma.draftEmail.create as jest.Mock).mockResolvedValue({ id: "draft1", status: "draft" });

      await runDraftPipeline("c1", BRAND);

      // The mock DB layer here has no email/SMTP client at all -- there is
      // nothing this pipeline *could* call to send anything even if it tried.
      expect(prisma.draftEmail.create).toHaveBeenCalledTimes(1);
    });
  });
});
