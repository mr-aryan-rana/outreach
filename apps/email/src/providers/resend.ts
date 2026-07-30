import { Resend } from "resend";
import { EmailProviderAdapter, EmailSendError, SendEmailRequest, SendEmailResult } from "./types";

export class ResendProvider implements EmailProviderAdapter {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    const from = request.fromName ? `${request.fromName} <${request.from}>` : request.from;
    const { data, error } = await this.client.emails.send({
      from,
      to: request.to,
      replyTo: request.replyTo,
      subject: request.subject,
      text: request.body,
    });

    if (error || !data) {
      // Resend's SDK reports API-level errors in `error`, not by throwing --
      // most (rate limit, transient 5xx) are retryable; a hard validation
      // error (malformed address) is not, but Resend doesn't cleanly expose
      // that distinction in this SDK version either -- same conservative
      // "retryable" default as the SMTP adapter, bounded by max attempts.
      throw new EmailSendError(error?.message ?? "Resend returned no data and no error", this.name, true);
    }
    return { providerMessageId: data.id };
  }
}
