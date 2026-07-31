import { NextRequest } from "next/server";
import { serverEnv } from "@/lib/serverEnv";
import { proxyRequest } from "@/lib/proxyHandler";

const target = { baseUrl: serverEnv.aiServiceUrl, apiKey: serverEnv.aiServiceApiKey };

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, target, path);
}

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
