import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { EmailProviderAdapter, EmailSendError, SendEmailRequest, SendEmailResult } from "./types";

export class SesProvider implements EmailProviderAdapter {
  readonly name = "ses";
  private readonly client: SESv2Client;

  constructor(region: string) {
    // Credentials resolved via the standard AWS SDK chain (env vars,
    // shared config file, or an IAM role) -- never hardcoded or passed as a
    // plain string here, unlike the other providers' single API-key model.
    this.client = new SESv2Client({ region });
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: request.fromName ? `${request.fromName} <${request.from}>` : request.from,
          Destination: { ToAddresses: [request.to] },
          ReplyToAddresses: request.replyTo ? [request.replyTo] : undefined,
          Content: {
            Simple: {
              Subject: { Data: request.subject, Charset: "UTF-8" },
              Body: { Text: { Data: request.body, Charset: "UTF-8" } },
            },
          },
        })
      );
      return { providerMessageId: result.MessageId ?? "" };
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      // Throttling/service errors are retryable; a rejected/malformed
      // address is not -- SES's SDK does distinguish these via error name,
      // unlike the other adapters here.
      const retryable = !["MessageRejected", "AccountSuspendedException"].includes(name);
      throw new EmailSendError((err as Error).message, this.name, retryable);
    }
  }
}
