export const REVIEW_WHATSAPP_SETTING = "review_whatsapp_templates";
export const MAX_REVIEW_WHATSAPP_TEMPLATES = 10;

export type ReviewWhatsAppTemplate = {
  id: string;
  name: string;
  message: string;
};

export const REVIEW_WHATSAPP_PLACEHOLDERS = [
  { token: "{REVIEW_URL}", label: "Goko feedback link" },
  { token: "{GOOGLE_REVIEW_URL}", label: "Direct Google review link" },
] as const;

export const DEFAULT_REVIEW_MESSAGE = "Thank you for staying with us! ❤️\n\nHow was your experience? Please rate your stay:\n{REVIEW_URL}";
export const DEFAULT_GOOGLE_REVIEW_MESSAGE = "Thank you for staying with us! We’d appreciate a Google review:\n{GOOGLE_REVIEW_URL}";

export function parseReviewWhatsAppTemplates(value: string | null | undefined): ReviewWhatsAppTemplate[] | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.message === "string")
      .map((item) => ({ id: item.id.trim(), name: item.name.trim(), message: item.message.trim() }))
      .filter((item) => item.id && item.name && item.message)
      .slice(0, MAX_REVIEW_WHATSAPP_TEMPLATES);
  } catch {
    return [];
  }
}

export function defaultReviewWhatsAppTemplates(legacyMessage?: string | null): ReviewWhatsAppTemplate[] {
  return [
    { id: "review-feedback", name: "Review feedback", message: legacyMessage?.trim() || DEFAULT_REVIEW_MESSAGE },
    { id: "google-review", name: "Review us on Google", message: DEFAULT_GOOGLE_REVIEW_MESSAGE },
  ];
}

export function validateReviewWhatsAppTemplates(value: unknown): ReviewWhatsAppTemplate[] | null {
  if (!Array.isArray(value) || value.length > MAX_REVIEW_WHATSAPP_TEMPLATES) return null;
  const templates = value.map((item) => ({
    id: typeof item?.id === "string" ? item.id.trim() : "",
    name: typeof item?.name === "string" ? item.name.trim() : "",
    message: typeof item?.message === "string" ? item.message.trim() : "",
  }));
  if (templates.some((item) => !item.id || item.id.length > 100 || !item.name || item.name.length > 80 || !item.message || item.message.length > 2000)) return null;
  if (new Set(templates.map((item) => item.id)).size !== templates.length) return null;
  return templates;
}

export function reviewGoogleUrl(value: string | null | undefined): string {
  try {
    const url = new URL(value?.trim() || "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function fillReviewWhatsAppTemplate(message: string, values: { reviewUrl: string; googleReviewUrl: string }): string {
  return message
    .replaceAll("{REVIEW_URL}", values.reviewUrl)
    .replaceAll("{GOOGLE_REVIEW_URL}", values.googleReviewUrl);
}
