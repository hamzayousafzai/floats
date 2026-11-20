const MAX_LOG_LENGTH = 500;
const SECRET_ENV_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "RESEND_API_KEY", "CRON_SECRET"] as const;

/** Redacts credentials and bounds length so errors are safe to print in CI logs. */
export function sanitizeForLog(
  value: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  let text = value instanceof Error ? value.message : typeof value === "string" ? value : "Unknown error";

  for (const key of SECRET_ENV_KEYS) {
    const secret = env[key];
    if (secret && secret.length >= 8) text = text.split(secret).join("[REDACTED]");
  }
  text = text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]")
    .replace(/\b(sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]{8,}/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//[REDACTED]@");

  return text.length > MAX_LOG_LENGTH ? `${text.slice(0, MAX_LOG_LENGTH)}...` : text;
}

/** Runs a CLI entrypoint, logging only sanitized errors and setting a nonzero exit code on failure. */
export async function runCli(name: string, main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`[${name}] failed: ${sanitizeForLog(error)}`);
    process.exitCode = 1;
  }
}
