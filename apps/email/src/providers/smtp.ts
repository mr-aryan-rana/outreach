import nodemailer, { Transporter } from "nodemailer";
import { EmailProviderAdapter, EmailSendError, SendEmailRequest, SendEmailResult } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export class SmtpProvider implements EmailProviderAdapter {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.username, pass: config.password },
    });
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        to: request.to,
        from: request.fromName ? `"${request.fromName}" <${request.from}>` : request.from,
        replyTo: request.replyTo,
        subject: request.subject,
        text: request.body,
      });
      return { providerMessageId: info.messageId };
    } catch (err) {
      // SMTP connection/auth failures are typically transient (network,
      // rate limiting by the receiving MTA); a hard 5xx-equivalent
      // rejection is rarer but nodemailer doesn't cleanly distinguish them
      // at this layer -- treat all SMTP failures as retryable and let the
      // queue's max-attempts ceiling bound the blast radius.
      throw new EmailSendError((err as Error).message, this.name, true);
    }
  }
}
