import crypto from "crypto";
import { logger } from "../logger";

/**
 * Real per-provider webhook signature verification (Sprint 6) -- replaces
 * the shared-secret-token-only scheme flagged as a gap in docs/SECURITY.md
 * "Webhook authentication" since Sprint 4. Each function verifies the
 * cryptographic signature the provider actually attaches to the request;
 * none of them require a live network call to the provider except SES's SNS
 * certificate fetch (see verifySesSnsSignature), which is restricted to
 * AWS-owned hostnames to prevent SSRF.
 */

// ---- Resend (Svix-format signing) ----
// https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
export function verifyResendSignature(
  rawBody: Buffer,
  headers: { "svix-id"?: string; "svix-timestamp"?: string; "svix-signature"?: string },
  secret: string
): boolean {
  const svixId = headers["svix-id"];
  const svixTimestamp = headers["svix-timestamp"];
  const svixSignature = headers["svix-signature"];
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject stale webhooks (replay protection) -- 5 minute tolerance, same as
  // Svix's own reference implementation.
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return false;
  }

  const secretBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;
  const expectedSignature = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  // svix-signature can contain multiple space-separated "v1,<base64>" values
  // (key rotation overlap) -- valid if any one matches.
  return svixSignature.split(" ").some((candidate) => {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(expectedSignature, "base64"));
    } catch {
      return false; // length mismatch -- timingSafeEqual throws rather than returning false
    }
  });
}

// ---- SendGrid (ECDSA P-256 Event Webhook signing) ----
// https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
export function verifySendGridSignature(
  rawBody: Buffer,
  headers: { "x-twilio-email-event-webhook-signature"?: string; "x-twilio-email-event-webhook-timestamp"?: string },
  publicKeyBase64: string
): boolean {
  const signature = headers["x-twilio-email-event-webhook-signature"];
  const timestamp = headers["x-twilio-email-event-webhook-timestamp"];
  if (!signature || !timestamp) return false;

  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const signedPayload = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    return crypto.verify(null, signedPayload, publicKey, Buffer.from(signature, "base64"));
  } catch (err) {
    logger.warn({ event: "sendgrid_signature_verify_error", error: (err as Error).message });
    return false;
  }
}

// ---- SES (via SNS message signing) ----
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
const ALLOWED_SIGNING_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
}

function buildCanonicalString(msg: SnsMessage): string {
  // Field order and inclusion rules are fixed by the SNS message-signing
  // spec and differ by Type -- see the AWS doc linked above.
  const fields: [string, string | undefined][] =
    msg.Type === "Notification"
      ? [
          ["Message", msg.Message],
          ["MessageId", msg.MessageId],
          ["Subject", msg.Subject],
          ["Timestamp", msg.Timestamp],
          ["TopicArn", msg.TopicArn],
          ["Type", msg.Type],
        ]
      : [
          ["Message", msg.Message],
          ["MessageId", msg.MessageId],
          ["SubscribeURL", msg.SubscribeURL],
          ["Timestamp", msg.Timestamp],
          ["Token", msg.Token],
          ["TopicArn", msg.TopicArn],
          ["Type", msg.Type],
        ];

  let canonical = "";
  for (const [key, value] of fields) {
    if (value === undefined) continue; // "Subject" is optional and omitted entirely if absent
    canonical += `${key}\n${value}\n`;
  }
  return canonical;
}

/**
 * SSRF guard: only ever fetches a signing certificate from an
 * *.amazonaws.com SNS hostname over HTTPS -- an attacker-supplied
 * SigningCertURL pointing anywhere else (internal network, another host) is
 * rejected before any request is made. Mirrors apps/python/extractor's own
 * SSRF guard philosophy (validate the target before fetching, not just the
 * URL's syntax).
 */
function assertSafeSigningCertUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_SIGNING_CERT_HOST.test(parsed.hostname)) {
    throw new Error(`refusing to fetch signing cert from untrusted host: ${parsed.hostname}`);
  }
  return parsed;
}

const certCache = new Map<string, string>();

async function fetchSigningCert(url: string): Promise<string> {
  const cached = certCache.get(url);
  if (cached) return cached;

  const safeUrl = assertSafeSigningCertUrl(url);
  const res = await fetch(safeUrl, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`failed to fetch SNS signing cert: ${res.status}`);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

export async function verifySesSnsSignature(body: unknown): Promise<boolean> {
  const msg = body as Partial<SnsMessage>;
  if (
    !msg.Type ||
    !msg.MessageId ||
    !msg.TopicArn ||
    !msg.Message ||
    !msg.Timestamp ||
    !msg.Signature ||
    !msg.SigningCertURL
  ) {
    return false;
  }

  try {
    const pem = await fetchSigningCert(msg.SigningCertURL);
    const canonical = buildCanonicalString(msg as SnsMessage);
    const algorithm = msg.SignatureVersion === "2" ? "sha256" : "sha1"; // SNS defaults to SignatureVersion 1 (SHA1) unless configured otherwise
    return crypto.verify(algorithm, Buffer.from(canonical, "utf8"), pem, Buffer.from(msg.Signature, "base64"));
  } catch (err) {
    logger.warn({ event: "ses_sns_signature_verify_error", error: (err as Error).message });
    return false;
  }
}
