import { PROJECT_ID_LENGTH, PROJECT_ID_PREFIX } from "@/lib/constants";

/** Unambiguous lowercase alphabet (no `l`, `o`, `1`, `0`). */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Generates a collision-resistant project id such as `proj_a7f29c1d`.
 *
 * Uses Web Crypto (available in Node 18+, Edge and browsers) with rejection
 * sampling so the distribution over `ALPHABET` stays uniform.
 */
export function generateProjectId(): string {
  const max = 256 - (256 % ALPHABET.length);
  let out = "";

  while (out.length < PROJECT_ID_LENGTH) {
    const bytes = new Uint8Array(PROJECT_ID_LENGTH);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= max) continue; // reject, keeps the mapping unbiased
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === PROJECT_ID_LENGTH) break;
    }
  }

  return `${PROJECT_ID_PREFIX}${out}`;
}

/** Random opaque reference used to de-duplicate upload registrations. */
export function generateUploadRef(): string {
  return crypto.randomUUID();
}
