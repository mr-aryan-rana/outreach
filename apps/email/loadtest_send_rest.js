const BASE = "http://localhost:8005/api/v1";
const KEY = process.env.EMAIL_API_KEY;

const campaignIds = [
  "4dda5817-df84-4d7f-9234-a93720a17894",
  "fa47c1c8-72f3-4540-a0cd-97068d45d86d",
  "b22f6744-e986-4e78-8be7-05400c236010",
  "945fb1be-458e-4702-92b9-ba452843f106",
  "e81293a0-cf39-4551-b5a7-0f1ddb16cdc6",
  "6cca7d77-8371-4828-a25d-66c26fdf6079",
  "0c4f2da1-d300-46f0-ac12-987d1a2e5478",
  "06d68dfa-113c-41ad-85b5-be5a8a76d441",
  "b0229242-7836-4ed6-9344-96b7348843b2",
];

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
  for (const id of campaignIds) {
    const t0 = Date.now();
    const result = await api("POST", `/campaigns/${id}/send`);
    console.log(`[${new Date().toISOString()}] sent ${id}: enqueued=${result.enqueued} (took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log("DONE sending all remaining campaigns");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
