import { randomUUID } from "crypto";
import { logger } from "../logger";
import { EmailProviderAdapter, SendEmailRequest, SendEmailResult } from "./types";

/**
 * Zero-network, zero-cost provider used for tests and for local/CI
 * verification. Never sends anything anywhere -- logs the send at `info`
 * level (subject/recipient only, never used for anything but local
 * debugging) and returns a fake message id. This is the *default* provider
 * in this repo's own .env.example specifically so nothing here can
 * accidentally send a real email without a deliberate, explicit provider
 * configuration change.
 */
export class MockEmailProvider implements EmailProviderAdapter {
  readonly name = "mock";

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    const providerMessageId = `mock-${randomUUID()}`;
    logger.info({
      event: "mock_email_send",
      to: request.to,
      from: request.from,
      subject: request.subject,
      providerMessageId,
    });
    return { providerMessageId };
  }
}
