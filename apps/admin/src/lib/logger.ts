import "server-only";

// Minimal structured logger -- matches the "ship JSON lines to your log
// aggregator of choice, nothing in-repo does this yet" pattern used by the
// other three services (pino there; console.error here is deliberately
// lightweight since apps/admin has no other server-side logging need beyond
// this). Never logs request bodies/secrets.
function log(level: "info" | "warn" | "error", fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (fields: Record<string, unknown>) => log("info", fields),
  warn: (fields: Record<string, unknown>) => log("warn", fields),
  error: (fields: Record<string, unknown>) => log("error", fields),
};
