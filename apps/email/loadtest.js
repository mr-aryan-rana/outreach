const BASE = "http://localhost:8005/api/v1";
const KEY = process.env.EMAIL_API_KEY;
const CREATOR_ID = process.env.LT_CREATOR_ID;
const DRAFT_ID = process.env.LT_DRAFT_ID;
const SENDER_ID = process.env.LT_SENDER_ID;

const NUM_CAMPAIGNS = 10;
const RECIPIENTS_PER_CAMPAIGN = 1000;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const campaignIds = [];
  const t0 = Date.now();

  for (let c = 0; c < NUM_CAMPAIGNS; c++) {
    const recipients = Array.from({ length: RECIPIENTS_PER_CAMPAIGN }, (_, i) => ({
      creatorId: CREATOR_ID,
      draftEmailId: DRAFT_ID,
      email: `loadtest-c${c}-r${i}@example.test`,
    }));
    const campaign = await api("POST", "/campaigns", {
      name: `Load test campaign ${c + 1}/${NUM_CAMPAIGNS}`,
      senderProfileId: SENDER_ID,
      recipients,
    });
    campaignIds.push(campaign.id);
    console.log(`[${new Date().toISOString()}] created campaign ${c + 1}/${NUM_CAMPAIGNS} (${campaign.id}) with ${campaign.recipients.length} recipients`);
  }
  const tCreated = Date.now();
  console.log(`\nAll ${NUM_CAMPAIGNS} campaigns created (${NUM_CAMPAIGNS * RECIPIENTS_PER_CAMPAIGN} total recipients) in ${((tCreated - t0) / 1000).toFixed(1)}s`);

  for (const id of campaignIds) {
    await api("POST", `/campaigns/${id}/approve`, { approvedBy: "loadtest" });
  }
  const tApproved = Date.now();
  console.log(`All campaigns approved in ${((tApproved - tCreated) / 1000).toFixed(1)}s`);

  let totalEnqueued = 0;
  for (const id of campaignIds) {
    const result = await api("POST", `/campaigns/${id}/send`);
    totalEnqueued += result.enqueued;
  }
  const tSent = Date.now();
  console.log(`All campaigns sent (enqueued ${totalEnqueued} jobs) in ${((tSent - tApproved) / 1000).toFixed(1)}s`);
  console.log(`\nTotal enqueue pipeline (create+approve+send) time: ${((tSent - t0) / 1000).toFixed(1)}s`);
  console.log(`\ncampaignIds=${JSON.stringify(campaignIds)}`);
}

main().catch((e) => {
  console.error("LOAD TEST ERROR:", e.message);
  process.exit(1);
});
