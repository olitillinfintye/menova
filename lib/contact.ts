import { invalidRequest } from "@/lib/errors";

export const CONTACT_LIMITS = {
  name: 120,
  email: 254,
  phone: 50,
  company: 160,
  message: 5000,
} as const;

export interface ContactInput {
  submissionId: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
}

export function parseContact(raw: unknown): ContactInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidRequest("Please submit your contact details.");
  }
  const values = raw as Record<string, unknown>;
  if (typeof values.website === "string" && values.website.trim()) return null;
  if (values.website !== undefined && typeof values.website !== "string") {
    throw invalidRequest("Invalid form submission.");
  }

  const text = (field: keyof typeof CONTACT_LIMITS, label: string, required = false) => {
    const value = values[field];
    if (value === undefined && !required) return "";
    if (typeof value !== "string") throw invalidRequest(`${label} must be text.`);
    const trimmed = value.trim();
    if (required && !trimmed) throw invalidRequest(`${label} is required.`);
    if (trimmed.length > CONTACT_LIMITS[field]) {
      throw invalidRequest(`${label} must be ${CONTACT_LIMITS[field]} characters or fewer.`);
    }
    if (/\u0000/.test(trimmed)) throw invalidRequest(`${label} contains an invalid character.`);
    return trimmed;
  };

  const name = text("name", "Name", true);
  const email = text("email", "Email", true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalidRequest("Enter a valid email address.");
  }
  const phone = text("phone", "Phone");
  const company = text("company", "Company");
  const message = text("message", "Project details", true);
  if (message.length < 10) throw invalidRequest("Project details must contain at least 10 characters.");
  if (typeof values.submissionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(values.submissionId)) {
    throw invalidRequest("Invalid submission reference. Refresh the page and try again.");
  }

  return { submissionId: values.submissionId, name, email, phone, company, message };
}