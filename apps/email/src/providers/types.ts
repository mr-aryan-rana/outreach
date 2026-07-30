export interface SendEmailRequest {
  to: string;
  from: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  providerMessageId: string;
}

/**
 * One implementation per provider (SMTP, Resend, SES, SendGrid, Mock) behind
 * this single method -- adapter pattern per requirement #1. Nothing upstream
 * (queue worker, campaign service) knows which provider is in use; adding a
 * fifth provider is a new file implementing this interface plus a case in
 * registry.ts, nothing else.
 */
export interface EmailProviderAdapter {
  readonly name: string;
  send(request: SendEmailRequest): Promise<SendEmailResult>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}
