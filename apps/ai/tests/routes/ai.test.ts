jest.mock("../../src/db", () => ({
  prisma: {
    aiJob: { findUnique: jest.fn() },
    draftEmail: { findUnique: jest.fn() },
  },
}));

jest.mock("../../src/services/pipeline", () => ({
  runSummaryPipeline: jest.fn(),
  runBrandFitPipeline: jest.fn(),
  runDraftPipeline: jest.fn(),
}));

import request from "supertest";
import { prisma } from "../../src/db";
import { CreatorNotFoundError } from "../../src/services/creatorClient";
import { runBrandFitPipeline, runDraftPipeline, runSummaryPipeline } from "../../src/services/pipeline";
import { buildTestApp, TEST_API_KEY } from "../testApp";

const VALID_CREATOR_ID = "11111111-1111-1111-1111-111111111111";
const VALID_JOB_ID = "22222222-2222-2222-2222-222222222222";

describe("POST /api/v1/ai/summary", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects requests without a valid API key", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v1/ai/summary").send({ creatorId: VALID_CREATOR_ID });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid creatorId", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ai/summary")
      .set("X-API-Key", TEST_API_KEY)
      .send({ creatorId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_body");
  });

  it("returns 404 with creator_not_found when the creator doesn't exist", async () => {
    (runSummaryPipeline as jest.Mock).mockRejectedValue(new CreatorNotFoundError(VALID_CREATOR_ID));
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ai/summary")
      .set("X-API-Key", TEST_API_KEY)
      .send({ creatorId: VALID_CREATOR_ID });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("creator_not_found");
  });

  it("returns the pipeline result on success", async () => {
    (runSummaryPipeline as jest.Mock).mockResolvedValue({ jobId: "job1", summary: { summary: "text" } });
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ai/summary")
      .set("X-API-Key", TEST_API_KEY)
      .send({ creatorId: VALID_CREATOR_ID });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe("job1");
  });
});

describe("POST /api/v1/ai/brand-fit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a body missing brand info", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ai/brand-fit")
      .set("X-API-Key", TEST_API_KEY)
      .send({ creatorId: VALID_CREATOR_ID });
    expect(res.status).toBe(400);
  });

  it("passes brand + forceRegenerateSummary through to the pipeline", async () => {
    (runBrandFitPipeline as jest.Mock).mockResolvedValue({ jobId: "job1", fitScore: 0.5 });
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ai/brand-fit")
      .set("X-API-Key", TEST_API_KEY)
      .send({
        creatorId: VALID_CREATOR_ID,
        forceRegenerateSummary: true,
        brand: { name: "Acme", description: "Widgets" },
      });

    expect(res.status).toBe(200);
    expect(runBrandFitPipeline).toHaveBeenCalledWith(
      VALID_CREATOR_ID,
      { name: "Acme", description: "Widgets" },
      expect.anything(),
      true
    );
  });
});

describe("POST /api/v1/ai/draft", () => {
  beforeEach(() => jest.clearAllMocks());

  it("never triggers email sending -- response contains only a saved draft, no send confirmation", async () => {
    (runDraftPipeline as jest.Mock).mockResolvedValue({
      jobId: "job1",
      draft: { id: "draft1", status: "draft" },
    });
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v1/ai/draft")
      .set("X-API-Key", TEST_API_KEY)
      .send({ creatorId: VALID_CREATOR_ID, brand: { name: "Acme", description: "Widgets" } });

    expect(res.status).toBe(200);
    expect(res.body.draft.status).toBe("draft");
    expect(res.body).not.toHaveProperty("sent");
    expect(res.body).not.toHaveProperty("emailSent");
  });
});

describe("GET /api/v1/ai/jobs/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a non-uuid job id", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/jobs/not-a-uuid").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown job", async () => {
    (prisma.aiJob.findUnique as jest.Mock).mockResolvedValue(null);
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/v1/ai/jobs/${VALID_JOB_ID}`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(404);
  });

  it("returns job detail including generations", async () => {
    (prisma.aiJob.findUnique as jest.Mock).mockResolvedValue({
      id: VALID_JOB_ID,
      creatorId: VALID_CREATOR_ID,
      jobType: "summary",
      status: "completed",
      input: {},
      result: { ok: true },
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
      generations: [{ id: "gen1", stage: "creator_summary", provider: "mock" }],
    });
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/v1/ai/jobs/${VALID_JOB_ID}`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.generations).toHaveLength(1);
  });
});

describe("GET /api/v1/ai/drafts/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects a non-uuid draft id", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/v1/ai/drafts/not-a-uuid").set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown draft", async () => {
    (prisma.draftEmail.findUnique as jest.Mock).mockResolvedValue(null);
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/v1/ai/drafts/${VALID_JOB_ID}`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(404);
  });

  it("returns draft content for apps/email to consume", async () => {
    (prisma.draftEmail.findUnique as jest.Mock).mockResolvedValue({
      id: VALID_JOB_ID,
      creatorId: VALID_CREATOR_ID,
      jobId: "job1",
      subject: "Hello",
      body: "Body text",
      brandFitScore: 0.8,
      qualityScore: 0.9,
      qualityNotes: "looks good",
      status: "draft",
      createdAt: new Date(),
    });
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/v1/ai/drafts/${VALID_JOB_ID}`).set("X-API-Key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe("Hello");
    expect(res.body.body).toBe("Body text");
    expect(res.body.status).toBe("draft");
  });
});
