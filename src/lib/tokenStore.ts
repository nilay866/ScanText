import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory download token store.
 * In production you'd use Redis or a database, but for a single-instance
 * deployment this is perfectly fine.
 */
interface DownloadToken {
  token: string;
  createdAt: number;
  used: boolean;
}

const tokenStore = new Map<string, DownloadToken>();

// Cleanup expired tokens every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of tokenStore) {
      if (now - val.createdAt > 10 * 60 * 1000) {
        tokenStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

/**
 * Create a new one-time download token. Returns the token string.
 */
export function createDownloadToken(): string {
  const token = uuidv4();
  tokenStore.set(token, {
    token,
    createdAt: Date.now(),
    used: false,
  });
  return token;
}

/**
 * Validate and consume a download token (one-time use).
 * Returns true if valid, false otherwise. Deletes used/expired tokens.
 */
export function validateAndConsumeToken(token: string): boolean {
  const entry = tokenStore.get(token);
  if (!entry) return false;
  if (entry.used) return false;
  // Tokens expire after 5 minutes
  if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
    tokenStore.delete(token);
    return false;
  }
  entry.used = true;
  tokenStore.delete(token);
  return true;
}
