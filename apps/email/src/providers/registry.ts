import { env } from "../config/env";
import { emailProviderFailuresTotal, emailSendDuration } from "../services/metrics";
import { MockEmailProvider } from "./mock";
import { ResendProvider } from "./resend";
import { getResiliencePolicy } from "./resilience";
import { SendGridProvider } from "./sendgrid";
import { SesProvider } from "./ses";
import { SmtpProvider } from "./smtp";
import { EmailProviderAdapter, SendEmailRequest, SendEmailResult } from "./types";

const instances = new Map<string, EmailProviderAdapter>();

/**
 * Provider is selected per SenderProfile row (requirement #1: adapter
 * pattern, never locked to one provider), not a single global setting --
 * different campaigns can use different sender profiles/providers.
 */
export function getProvider(name: string): EmailProviderAdapter {
  const cached = instances.get(name);
  if (cached) return cached;

  let provider: EmailProviderAdapter;
  switch (name) {
    case "mock":
      provider = new MockEmailProvider();
      break;
    case "smtp":
      if (!env.smtpHost || !env.smtpPort || !env.smtpUsername || !env.smtpPassword) {
        throw new Error("SMTP_HOST/SMTP_PORT/SMTP_USERNAME/SMTP_PASSWORD are not fully configured");
      }
      provider = new SmtpProvider({
        host: env.smtpHost,
        port: env.smtpPort,
        username: env.smtpUsername,
        password: env.smtpPassword,
      });
      break;
    case "resend":
      if (!env.resendApiKey) throw new Error("RESEND_API_KEY is not configured");
      provider = new ResendProvider(env.resendApiKey);
      break;
    case "ses":
      if (!env.sesRegion) throw new Error("AWS_REGION/SES_REGION is not configured");
      provider = new SesProvider(env.sesRegion);
      break;
    case "sendgrid":
      if (!env.sendgridApiKey) throw new Error("SENDGRID_API_KEY is not configured");
      provider = new SendGridProvider(env.sendgridApiKey);
      break;
    default:
      throw new Error(`Unknown email provider "${name}"`);
  }
  instances.set(name, provider);
  return provider;
}

/**
 * The only send path in this service -- every call goes through resilience
 * (retry -> circuit breaker -> timeout) and records the two send-level
 * metrics. Does NOT catch/retry beyond the resilience policy's single
 * attempt; the queue worker (src/queue/worker.ts) owns job-level retry with
 * its own backoff on top of this.
 */
export async function sendViaProvider(providerName: string, request: SendEmailRequest): Promise<SendEmailResult> {
  const provider = getProvider(providerName);
  const policy = getResiliencePolicy(providerName);
  const start = process.hrtime.bigint();
  try {
    const result = await policy.execute(() => provider.send(request));
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    emailSendDuration.labels(providerName, "success").observe(latencyMs / 1000);
    return result;
  } catch (err) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    emailSendDuration.labels(providerName, "failure").observe(latencyMs / 1000);
    emailProviderFailuresTotal.labels(providerName, (err as Error).name || "error").inc();
    throw err;
  }
}
