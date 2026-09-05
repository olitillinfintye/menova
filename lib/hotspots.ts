import { MAX_HOTSPOTS, MAX_HOTSPOT_LABEL } from "@/lib/constants";
import { invalidRequest } from "@/lib/errors";
import type { Hotspot } from "@/lib/types";

const COORD_LIMIT = 5000;

function finiteWithin(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

/**
 * Validates and normalises a hotspot list from an untrusted source (request
 * body or a JSON column). Throws `invalid_request` for malformed client input.
 */
export function parseHotspots(raw: unknown): Hotspot[] {
  if (!Array.isArray(raw)) throw invalidRequest("hotspots must be an array.");
  if (raw.length > MAX_HOTSPOTS) {
    throw invalidRequest(`A project can have at most ${MAX_HOTSPOTS} hotspots.`);
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw invalidRequest(`hotspots[${index}] must be an object.`);
    }
    const { id, label, position, yaw } = entry as Record<string, unknown>;

    if (typeof id !== "string" || !/^[a-z0-9_-]{4,40}$/i.test(id)) {
      throw invalidRequest(`hotspots[${index}].id is invalid.`);
    }
    if (seen.has(id)) throw invalidRequest(`Duplicate hotspot id "${id}".`);
    seen.add(id);

    const safeLabel =
      typeof label === "string" && label.trim() ? label.trim().slice(0, MAX_HOTSPOT_LABEL) : `Point ${index + 1}`;

    const pos = position as Record<string, unknown> | undefined;
    if (
      !pos ||
      !finiteWithin(pos.x, COORD_LIMIT) ||
      !finiteWithin(pos.y, COORD_LIMIT) ||
      !finiteWithin(pos.z, COORD_LIMIT)
    ) {
      throw invalidRequest(`hotspots[${index}].position must have finite x, y, z.`);
    }
    if (!finiteWithin(yaw, Math.PI * 4)) {
      throw invalidRequest(`hotspots[${index}].yaw must be a finite angle in radians.`);
    }

    return { id, label: safeLabel, position: { x: pos.x, y: pos.y, z: pos.z }, yaw };
  });
}

/** Lenient parse for rows already in the database: drops anything malformed. */
export function hotspotsFromRow(raw: unknown): Hotspot[] {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parseHotspots(value ?? []);
  } catch {
    return [];
  }
}
