import crypto from "crypto";
import { verifyResendSignature, verifySendGridSignature, verifySesSnsSignature } from "../../src/services/webhookSignature";

describe("verifyResendSignature", () => {
  const secretBytes = crypto.randomBytes(32);
  const secret = `whsec_${secretBytes.toString("base64")}`;

  function sign(id: string, timestamp: string, body: string): string {
    const signedContent = `${id}.${timestamp}.${body}`;
    return crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  }

  it("accepts a correctly signed payload", () => {
    const body = Buffer.from(JSON.stringify({ type: "email.delivered" }));
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = sign(id, timestamp, body.toString("utf8"));

    const ok = verifyResendSignature(
      body,
      { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}` },
      secret
    );
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const originalBody = "original";
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = sign(id, timestamp, originalBody);

    const ok = verifyResendSignature(
      Buffer.from("tampered"),
      { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}` },
      secret
    );
    expect(ok).toBe(false);
  });

  it("rejects a stale timestamp (replay protection)", () => {
    const body = "payload";
    const id = "msg_1";
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour old
    const sig = sign(id, staleTimestamp, body);

    const ok = verifyResendSignature(
      Buffer.from(body),
      { "svix-id": id, "svix-timestamp": staleTimestamp, "svix-signature": `v1,${sig}` },
      secret
    );
    expect(ok).toBe(false);
  });

  it("rejects when required headers are missing", () => {
    const ok = verifyResendSignature(Buffer.from("x"), {}, secret);
    expect(ok).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const wrongSecretBytes = crypto.randomBytes(32);
    const body = "payload";
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const badSig = crypto.createHmac("sha256", wrongSecretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");

    const ok = verifyResendSignature(
      Buffer.from(body),
      { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${badSig}` },
      secret
    );
    expect(ok).toBe(false);
  });
});

describe("verifySendGridSignature", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

  function sign(timestamp: string, body: Buffer): string {
    const signedPayload = Buffer.concat([Buffer.from(timestamp, "utf8"), body]);
    return crypto.sign(null, signedPayload, privateKey).toString("base64");
  }

  it("accepts a correctly signed payload", () => {
    const body = Buffer.from(JSON.stringify([{ event: "delivered" }]));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, body);

    const ok = verifySendGridSignature(
      body,
      { "x-twilio-email-event-webhook-signature": signature, "x-twilio-email-event-webhook-timestamp": timestamp },
      publicKeyBase64
    );
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, Buffer.from("original"));

    const ok = verifySendGridSignature(
      Buffer.from("tampered"),
      { "x-twilio-email-event-webhook-signature": signature, "x-twilio-email-event-webhook-timestamp": timestamp },
      publicKeyBase64
    );
    expect(ok).toBe(false);
  });

  it("rejects when signature headers are missing", () => {
    const ok = verifySendGridSignature(Buffer.from("x"), {}, publicKeyBase64);
    expect(ok).toBe(false);
  });

  it("rejects a signature verified against the wrong public key", () => {
    const { publicKey: otherPublicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const otherPublicKeyBase64 = otherPublicKey.export({ format: "der", type: "spki" }).toString("base64");
    const body = Buffer.from("payload");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, body);

    const ok = verifySendGridSignature(
      body,
      { "x-twilio-email-event-webhook-signature": signature, "x-twilio-email-event-webhook-timestamp": timestamp },
      otherPublicKeyBase64
    );
    expect(ok).toBe(false);
  });
});

describe("verifySesSnsSignature", () => {
  it("returns false for a payload missing required SNS fields", async () => {
    const ok = await verifySesSnsSignature({ Type: "Notification" });
    expect(ok).toBe(false);
  });

  // SSRF guard: SigningCertURL must be an *.amazonaws.com host over HTTPS --
  // an attacker-supplied URL pointing anywhere else must be rejected before
  // any network request is attempted, not just fail on a network error.
  it("refuses to fetch a signing cert from a non-AWS host (SSRF guard)", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const ok = await verifySesSnsSignature({
      Type: "Notification",
      MessageId: "m1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      Message: "hello",
      Timestamp: new Date().toISOString(),
      Signature: Buffer.from("fake").toString("base64"),
      SigningCertURL: "https://evil.example.com/cert.pem",
    });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses a non-HTTPS SigningCertURL even on an amazonaws.com host", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const ok = await verifySesSnsSignature({
      Type: "Notification",
      MessageId: "m1",
      TopicArn: "arn:aws:sns:us-east-1:123456789012:topic",
      Message: "hello",
      Timestamp: new Date().toISOString(),
      Signature: Buffer.from("fake").toString("base64"),
      SigningCertURL: "http://sns.us-east-1.amazonaws.com/cert.pem",
    });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
