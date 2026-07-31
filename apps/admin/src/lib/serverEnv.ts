import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Server-only: imported exclusively by src/app/api/proxy/*/[...path]/route.ts
// (Next.js Route Handlers, which always run server-side). The `server-only`
// import above makes any accidental client-component import a build error,
// not just a convention -- these three API keys must never reach the browser
// bundle. See docs/SECURITY.md "Admin app: no client-side API keys".
export const serverEnv = {
  backendUrl: required("BACKEND_URL"),
  backendApiKey: required("BACKEND_API_KEY"),
  aiServiceUrl: required("AI_SERVICE_URL"),
  aiServiceApiKey: required("AI_SERVICE_API_KEY"),
  emailServiceUrl: required("EMAIL_SERVICE_URL"),
  emailServiceApiKey: required("EMAIL_SERVICE_API_KEY"),
  adminActorName: process.env.ADMIN_ACTOR_NAME ?? "admin",
};
