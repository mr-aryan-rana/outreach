import { Queue } from "bullmq";
import { env } from "../config/env";
import { createQueueConnection } from "./connection";

export const EMAIL_SEND_QUEUE = "email-send";
export const EMAIL_SEND_DLQ = "email-send-dlq";

export interface EmailSendJobData {
  campaignRecipientId: string;
}

let sendQueue: Queue<EmailSendJobData> | undefined;
let dlq: Queue<EmailSendJobData> | undefined;

export function getEmailSendQueue(): Queue<EmailSendJobData> {
  if (!sendQueue) {
    sendQueue = new Queue(EMAIL_SEND_QUEUE, { connection: createQueueConnection() });
  }
  return sendQueue;
}

/**
 * Separate, explicitly-named queue for jobs that exhausted every retry
 * attempt -- requirement #2's "Dead Letter Queue". BullMQ already keeps
 * exhausted jobs in the source queue's own "failed" set, but a dedicated DLQ
 * gives operators a queue they can inspect/monitor/replay independently of
 * "some jobs still mid-retry, some permanently dead" ambiguity in a shared
 * failed set. See src/queue/worker.ts for what moves jobs here.
 */
export function getEmailSendDlq(): Queue<EmailSendJobData> {
  if (!dlq) {
    dlq = new Queue(EMAIL_SEND_DLQ, { connection: createQueueConnection() });
  }
  return dlq;
}

export interface EnqueueOptions {
  delayMs?: number;
  priority?: number;
}

/** Requirement #2: retry, delay, priority. */
export async function enqueueSend(campaignRecipientId: string, options: EnqueueOptions = {}) {
  const queue = getEmailSendQueue();
  return queue.add(
    "send",
    { campaignRecipientId },
    {
      attempts: env.queueMaxAttempts,
      backoff: { type: "exponential", delay: env.queueBackoffMs },
      delay: options.delayMs,
      priority: options.priority,
      removeOnComplete: { age: 7 * 24 * 3600 }, // keep 7 days for audit, then GC
      removeOnFail: false, // exhausted jobs are explicitly moved to the DLQ, not auto-removed
    }
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([sendQueue?.close(), dlq?.close()]);
}
