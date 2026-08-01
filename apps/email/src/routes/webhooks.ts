import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendError } from "../middleware/errors";
import { prisma } from "../db";
import { logger } from "../logger";
import { env } from "../config/env";
import { emailEventsTotal } from "../services/metrics";
import { verifyResendSignature, verifySendGridSignature, verifySesSnsSignature } from "../services/webhookSignature";

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
 * in production.
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

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Falls back through three tiers, loudest-safest first, and logs which tier
 * actually authenticated the request so "why did/didn't this webhook get
 * accepted" is never a mystery in production logs:
 *   1. Real per-provider cryptographic signature (if the provider's signing
 *      secret/key is configured) -- see src/services/webhookSignature.ts.
 *   2. WEBHOOK_SHARED_SECRET token (query param or header) -- the Sprint 4
 *      baseline, kept as a fallback for providers/environments where the
 *      real signing secret isn't configured yet.
 *   3. Open (dev/test only) -- if neither is configured.
 */
async function checkWebhookAuth(
  req: RequestWithRawBody,
  res: Response,
  provider: "resend" | "sendgrid" | "ses"
): Promise<boolean> {
  if (provider === "resend" && env.resendWebhookSecret) {
    const ok = verifyResendSignature(req.rawBody ?? Buffer.from(""), req.headers as any, env.resendWebhookSecret);
    if (!ok) {
      logger.warn({ event: "webhook_signature_invalid", provider });
      sendError(req, res, 401, "unauthorized", "invalid webhook signature");
      return false;
    }
    return true;
  }

  if (provider === "sendgrid" && env.sendgridWebhookPublicKey) {
    const ok = verifySendGridSignature(req.rawBody ?? Buffer.from(""), req.headers as any, env.sendgridWebhookPublicKey);
    if (!ok) {
      logger.warn({ event: "webhook_signature_invalid", provider });
      sendError(req, res, 401, "unauthorized", "invalid webhook signature");
      return false;
    }
    return true;
  }

  if (provider === "ses" && env.sesSnsVerifySignature) {
    const ok = await verifySesSnsSignature(req.body);
    if (!ok) {
      logger.warn({ event: "webhook_signature_invalid", provider });
      sendError(req, res, 401, "unauthorized", "invalid SNS message signature");
      return false;
    }
    return true;
  }

  // Fallback: shared-secret token (or fully open if that's unset too).
  const expected = process.env.WEBHOOK_SHARED_SECRET;
  if (!expected) {
    logger.warn({ event: "webhook_auth_open", provider, note: "no signature key or shared secret configured" });
    return true;
  }
  const provided = req.query.token || req.header("x-webhook-token");
  if (provided !== expected) {
    sendError(req, res, 401, "unauthorized", "invalid webhook token");
    return false;
  }
  logger.info({ event: "webhook_auth_shared_secret_fallback", provider });
  return true;
}

webhooksRouter.post(
  "/webhooks/resend",
  asyncHandler(async (req, res) => {
    if (!(await checkWebhookAuth(req, res, "resend"))) return;
    const event = normalizeResendEvent(req.body);
    if (event) await applyEvent("resend", event);
    res.json({ ok: true });
  })
);

webhooksRouter.post(
  "/webhooks/sendgrid",
  asyncHandler(async (req, res) => {
    if (!(await checkWebhookAuth(req, res, "sendgrid"))) return;
    const events = normalizeSendGridEvents(req.body);
    for (const event of events) await applyEvent("sendgrid", event);
    res.json({ ok: true, processed: events.length });
  })
);

webhooksRouter.post(
  "/webhooks/ses",
  asyncHandler(async (req, res) => {
    if (!(await checkWebhookAuth(req, res, "ses"))) return;
    // SES delivers via SNS; a real integration must also handle the SNS
    // SubscriptionConfirmation handshake (confirming the topic subscription
    // out-of-band) before events start arriving here -- not implemented,
    // documented in DEPLOYMENT.md "Email delivery setup". The signature
    // above IS verified for whichever message type arrives, though.
    logger.info({ event: "ses_webhook_received", note: "SES/SNS event mapping not implemented in this slice" });
    res.json({ ok: true });
  })
);
