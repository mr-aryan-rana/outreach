import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { logger } from "../logger";
import { emailEventsTotal } from "../services/metrics";

export const webhooksRouter = Router();

interface NormalizedEvent {
  providerMessageId: string;
  eventType: "delivered" | "deferred" | "bounced" | "opened" | "clicked" | "failed";
  metadata?: unknown;
}

/**
 * Provider payload shapes per their public webhook docs (Resend, SendGrid;
 * SES typically arrives via SNS with a nested Message field, handled the
 * same way once unwrapped). Best-effort mapping -- verify against the
 * actual provider account's current webhook format before relying on this
 * in production, and see docs/SECURITY.md "Webhook authentication" for what
 * this endpoint does and does NOT verify.
 */
function normalizeResendEvent(body: any): NormalizedEvent | undefined {
  const typeMap: Record<string, NormalizedEvent["eventType"]> = {
    "email.delivered": "delivered",
    "email.delivery_delayed": "deferred",
    "email.bounced": "bounced",
    "email.opened": "opened",
    "email.clicked": "clicked",
  };
  const eventType = typeMap[body?.type];
  const providerMessageId = body?.data?.email_id;
  if (!eventType || !providerMessageId) return undefined;
  return { providerMessageId, eventType, metadata: body.data };
}

function normalizeSendGridEvents(body: any): NormalizedEvent[] {
  const typeMap: Record<string, NormalizedEvent["eventType"]> = {
    delivered: "delivered",
    deferred: "deferred",
    bounce: "bounced",
    open: "opened",
    click: "clicked",
  };
  if (!Array.isArray(body)) return [];
  return body
    .map((e): NormalizedEvent | undefined => {
      const eventType = typeMap[e?.event];
      const providerMessageId = e?.sg_message_id;
      if (!eventType || !providerMessageId) return undefined;
      return { providerMessageId, eventType, metadata: e };
    })
    .filter((e): e is NormalizedEvent => Boolean(e));
}

async function applyEvent(provider: string, event: NormalizedEvent): Promise<void> {
  const log = await prisma.emailProviderLog.findFirst({
    where: { provider, responseBody: { path: ["providerMessageId"], equals: event.providerMessageId } },
    orderBy: { createdAt: "desc" },
  });
  if (!log?.campaignRecipientId) {
    logger.warn({ event: "webhook_event_unmatched", provider, providerMessageId: event.providerMessageId });
    return;
  }

  emailEventsTotal.labels(event.eventType).inc();
  await prisma.emailEvent.create({
    data: {
      campaignRecipientId: log.campaignRecipientId,
      eventType: event.eventType,
      providerMessageId: event.providerMessageId,
      metadata: event.metadata as any,
    },
  });
  await prisma.campaignRecipient.update({ where: { id: log.campaignRecipientId }, data: { status: event.eventType } });

  // Deliverability requirement: auto-suppress on hard bounce -- sending
  // repeatedly to a bouncing address damages sender reputation for every
  // future campaign, not just this one.
  if (event.eventType === "bounced") {
    const recipient = await prisma.campaignRecipient.findUnique({ where: { id: log.campaignRecipientId } });
    if (recipient) {
      await prisma.suppressionEntry
        .upsert({
          where: { email: recipient.email },
          create: { email: recipient.email, reason: "bounced", source: `webhook:${provider}` },
          update: {},
        })
        .catch(() => undefined); // already suppressed -- fine
    }
  }
}

function checkWebhookToken(req: any, res: any): boolean {
  // Baseline protection only -- NOT per-provider HMAC signature
  // verification. See docs/SECURITY.md "Webhook authentication" for why
  // this is documented as a gap to close before real production use, not
  // treated as sufficient on its own.
  const expected = process.env.WEBHOOK_SHARED_SECRET;
  if (!expected) return true; // not configured -- allowed in dev/test, logged as a warning below
  const provided = req.query.token || req.header("x-webhook-token");
  if (provided !== expected) {
    sendError(req, res, 401, "unauthorized", "invalid webhook token");
    return false;
  }
  return true;
}

webhooksRouter.post(
  "/webhooks/resend",
  asyncHandler(async (req, res) => {
    if (!checkWebhookToken(req, res)) return;
    const event = normalizeResendEvent(req.body);
    if (event) await applyEvent("resend", event);
    res.json({ ok: true });
  })
);

webhooksRouter.post(
  "/webhooks/sendgrid",
  asyncHandler(async (req, res) => {
    if (!checkWebhookToken(req, res)) return;
    const events = normalizeSendGridEvents(req.body);
    for (const event of events) await applyEvent("sendgrid", event);
    res.json({ ok: true, processed: events.length });
  })
);

webhooksRouter.post(
  "/webhooks/ses",
  asyncHandler(async (req, res) => {
    if (!checkWebhookToken(req, res)) return;
    // SES delivers via SNS; a real integration must also handle the SNS
    // SubscriptionConfirmation handshake (confirming the topic subscription
    // out-of-band) before events start arriving here -- not implemented,
    // documented in docs/DEPLOYMENT.md "Email delivery setup".
    logger.info({ event: "ses_webhook_received", note: "SES/SNS event mapping not implemented in this slice" });
    res.json({ ok: true });
  })
);
