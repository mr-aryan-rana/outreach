import { roleCan, isRole, ROLES } from "@/lib/rbac";
import { permissionForRequest } from "@/lib/permissionForRequest";

describe("rbac", () => {
  it("isRole validates known roles only", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(123)).toBe(false);
  });

  it("admin can do everything reviewer and operator can", () => {
    expect(roleCan("admin", "draft.review")).toBe(true);
    expect(roleCan("admin", "campaign.manage")).toBe(true);
    expect(roleCan("admin", "suppression.manage")).toBe(true);
    expect(roleCan("admin", "queue.retry")).toBe(true);
  });

  it("reviewer can only review drafts", () => {
    expect(roleCan("reviewer", "draft.review")).toBe(true);
    expect(roleCan("reviewer", "campaign.manage")).toBe(false);
    expect(roleCan("reviewer", "suppression.manage")).toBe(false);
  });

  it("operator can manage campaigns/suppression/senders/queue but not review drafts", () => {
    expect(roleCan("operator", "campaign.manage")).toBe(true);
    expect(roleCan("operator", "suppression.manage")).toBe(true);
    expect(roleCan("operator", "queue.retry")).toBe(true);
    expect(roleCan("operator", "draft.review")).toBe(false);
  });

  it("readonly can perform no mutating permission", () => {
    for (const permission of [
      "draft.review",
      "ai.generate",
      "campaign.manage",
      "suppression.manage",
      "sender_profile.manage",
      "queue.retry",
      "recipient.manage",
      "ingest.run",
    ] as const) {
      expect(roleCan("readonly", permission)).toBe(false);
    }
  });
});

describe("permissionForRequest", () => {
  it("never gates GET requests", () => {
    expect(permissionForRequest("GET", "email", "campaigns")).toBeNull();
    expect(permissionForRequest("GET", "ai", "ai/drafts/abc")).toBeNull();
  });

  it("maps PATCH /ai/drafts/:id to draft.review", () => {
    expect(permissionForRequest("PATCH", "ai", "ai/drafts/abc-123")).toBe("draft.review");
  });

  it("maps AI generation endpoints to ai.generate", () => {
    expect(permissionForRequest("POST", "ai", "ai/draft")).toBe("ai.generate");
    expect(permissionForRequest("POST", "ai", "ai/summary")).toBe("ai.generate");
    expect(permissionForRequest("POST", "ai", "ai/brand-fit")).toBe("ai.generate");
  });

  it("maps campaign mutations to campaign.manage", () => {
    expect(permissionForRequest("POST", "email", "campaigns")).toBe("campaign.manage");
    expect(permissionForRequest("POST", "email", "campaigns/id1/approve")).toBe("campaign.manage");
    expect(permissionForRequest("POST", "email", "campaigns/id1/send")).toBe("campaign.manage");
    expect(permissionForRequest("POST", "email", "campaigns/id1/pause")).toBe("campaign.manage");
    expect(permissionForRequest("POST", "email", "campaigns/id1/resume")).toBe("campaign.manage");
  });

  it("maps mark-replied to recipient.manage, not campaign.manage", () => {
    expect(permissionForRequest("POST", "email", "campaigns/id1/recipients/r1/mark-replied")).toBe("recipient.manage");
  });

  it("maps suppression/sender-profile/dlq-retry/ingest correctly", () => {
    expect(permissionForRequest("POST", "email", "suppression")).toBe("suppression.manage");
    expect(permissionForRequest("POST", "email", "sender-profiles")).toBe("sender_profile.manage");
    expect(permissionForRequest("POST", "email", "dashboard/queue/dlq/job1/retry")).toBe("queue.retry");
    expect(permissionForRequest("POST", "backend", "ingest/run")).toBe("ingest.run");
  });

  it("fails closed (undefined) for an unmapped mutating route", () => {
    expect(permissionForRequest("POST", "backend", "some/future/route")).toBeUndefined();
  });
});
