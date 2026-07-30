import sgMail from "@sendgrid/mail";
import { EmailProviderAdapter, EmailSendError, SendEmailRequest, SendEmailResult } from "./types";

export class SendGridProvider implements EmailProviderAdapter {
  readonly name = "sendgrid";

  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey);
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    try {
      const [response] = await sgMail.send({
        to: request.to,
        from: request.fromName ? { email: request.from, name: request.fromName } : request.from,
        replyTo: request.replyTo,
        subject: request.subject,
        text: request.body,
      });
      const providerMessageId = (response.headers["x-message-id"] as string | undefined) ?? "";
      return { providerMessageId };
    } catch (err: any) {
      const status = err?.code as number | undefined;
      // 4xx (except 429) means SendGrid rejected the request itself
      // (invalid address, unverified sender) -- retrying won't help.
      // 429/5xx are transient.
      const retryable = status === undefined || status === 429 || status >= 500;
      throw new EmailSendError(err?.message ?? "SendGrid send failed", this.name, retryable);
    }
  }
}
