import { createHmac } from "crypto";

/**
 * Verifies Telegram WebApp initData using HMAC-SHA256 with the "WebAppData" key.
 * Returns the parsed fields on success, or null if the signature is invalid.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): Record<string, string> | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) return null;

    const result: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      result[k] = v;
    }
    result["hash"] = hash;
    return result;
  } catch {
    return null;
  }
}

/**
 * Extracts and parses the Telegram user object from verified initData fields.
 * Returns null if the user field is missing or malformed.
 */
export function extractTelegramUser(
  verified: Record<string, string>,
): { id: number; first_name: string } | null {
  try {
    const user = JSON.parse(verified["user"] ?? "{}") as {
      id?: number;
      first_name?: string;
    };
    if (!user.id || !user.first_name) return null;
    return { id: user.id, first_name: user.first_name };
  } catch {
    return null;
  }
}
