/**
 * Default ID generator for events.
 * Uses crypto.randomUUID if available, falls back to a simple random string.
 */
export const generateId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for environments without crypto.randomUUID
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 21; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
};
