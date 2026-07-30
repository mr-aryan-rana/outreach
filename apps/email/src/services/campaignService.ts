import { prisma } from "../db";
import { env } from "../config/env";
import { emailDuplicateSkippedTotal, emailSuppressedTotal } from "./metrics";
import { enqueueSend } from "../queue/emailQueue";

export class InvalidStateTransitionError extends Error {
  constructor(from: string, action: string) {
    super(`cannot ${action} a campaign in status "${from}"`);
    this.name = "InvalidStateTransitionError";
  }
}

export interface RecipientInput {
  creatorId: string;
  draftEmailId: string;
  email: string;
}

/**
 * Sending Rules (docs/API.md): dedupe before sending, respect suppression,
 * one active send per recipient per campaign. Both checks run here (at
 * campaign-creation time, so the campaign's own recipient list already
 * reflects them) AND again in the queue worker immediately before the
 * provider call (src/queue/worker.ts) -- suppression state can change in
 * the window between creating a campaign and it actually being approved and
 * sent, sometimes days later.
 */
export async function createCampaign(params: {
  name: string;
  senderProfileId: string;
  recipients: RecipientInput[];
}) {
  const campaign = await prisma.campaign.create({
    data: { name: params.name, senderProfileId: params.senderProfileId, status: "pending_review" },
  });

  const suppressed = await prisma.suppressionEntry.findMany({
    where: { email: { in: params.recipients.map((r) => r.email.toLowerCase()) } },
    select: { email: true },
  });
  const suppressedSet = new Set(suppressed.map((s) => s.email));

  // De-duplicate the *input* list itself (same recipient listed twice in one
  // request) before touching the DB -- the unique(campaignId, email)
  // constraint would reject the second row anyway, but failing an entire
  // batch insert on one accidental duplicate is worse UX than silently
  // keeping the first occurrence and reporting it.
  const seenEmails = new Set<string>();
  const rows = [];
  for (const r of params.recipients) {
    const email = r.email.toLowerCase();
    if (seenEmails.has(email)) {
      emailDuplicateSkippedTotal.inc();
      continue;
    }
    seenEmails.add(email);

    const isSuppressed = suppressedSet.has(email);
    if (isSuppressed) emailSuppressedTotal.inc();

    rows.push({
      campaignId: campaign.id,
      creatorId: r.creatorId,
      draftEmailId: r.draftEmailId,
      email,
      status: isSuppressed ? "suppressed" : "pending",
    });
  }

  if (rows.length > 0) {
    await prisma.campaignRecipient.createMany({ data: rows });
  }

  return prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id }, include: { recipients: true } });
}

export async function approveCampaign(campaignId: string, approvedBy: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status !== "pending_review") {
    throw new InvalidStateTransitionError(campaign.status, "approve");
  }
  return prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "approved", approvedBy, approvedAt: new Date() },
  });
}

/**
 * The hard gate for "Never send AI drafts automatically" / "Human approval
 * required": this function refuses to enqueue anything unless the campaign
 * is already in "approved" status, which is only reachable via
 * approveCampaign() above -- there is no code path from "pending_review" or
 * "draft" straight into this function succeeding.
 *
 * Applies PROJECT.md §17's rate-limit/delay rules (MAX_EMAILS_PER_HOUR,
 * EMAIL_DELAY_MIN/MAX) by spacing each recipient's enqueue delay, and a
 * simple priority ramp (earlier recipients get slightly higher priority)
 * satisfying requirement #2's "priority" without needing per-recipient
 * caller-supplied priority in this slice.
 */
export async function sendCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status !== "approved") {
    throw new InvalidStateTransitionError(campaign.status, "send");
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "queued", sendStartedAt: new Date() } });

  const delayStepMs = Math.max(env.emailDelayMinSeconds, 1) * 1000;
  let cumulativeDelayMs = 0;
  let enqueuedCount = 0;

  for (const [index, recipient] of recipients.entries()) {
    // Spread sends across time rather than firing every recipient in the
    // same instant -- both a deliverability practice (warm/steady sending
    // pattern) and a literal implementation of PROJECT.md's
    // EMAIL_DELAY_MIN/MAX and MAX_EMAILS_PER_HOUR.
    const jitter = Math.floor(Math.random() * (env.emailDelayMaxSeconds - env.emailDelayMinSeconds + 1)) * 1000;
    cumulativeDelayMs += delayStepMs + jitter;

    const job = await enqueueSend(recipient.id, {
      delayMs: cumulativeDelayMs,
      priority: index + 1, // lower number = higher priority in BullMQ; earlier recipients go first
    });
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "queued", queueJobId: job.id },
    });
    enqueuedCount += 1;

    // MAX_EMAILS_PER_HOUR: once an hour's worth of sends have been spread
    // across the delay schedule, push the next batch's delays out by an
    // extra hour rather than ignoring the hourly cap.
    if (enqueuedCount % env.maxEmailsPerHour === 0) {
      cumulativeDelayMs += 3600_000;
    }
  }

  return { campaignId, enqueued: enqueuedCount };
}
