export type DietFilter = "all" | "veg" | "nonveg";
export type CuratedFilter = "chef-special" | "goko-special" | null;

export function parseFoodTags(tagsStr: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(tagsStr || "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function itemMatchesDiet(tags: string[], diet: DietFilter): boolean {
  if (diet === "all") return true;
  const lower = tags.map((t) => t.toLowerCase());
  if (diet === "veg") return lower.includes("veg");
  return lower.includes("non-veg") || lower.includes("nonveg");
}

export function itemMatchesCurated(tags: string[], curated: CuratedFilter): boolean {
  if (!curated) return true;
  return tags.map((t) => t.toLowerCase()).includes(curated);
}

export function itemMatchesSearch(
  item: { name: string; nameKannada?: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || Boolean(item.nameKannada?.includes(query.trim()));
}

export function dietEmptyMessage(diet: DietFilter): string {
  if (diet === "veg") return "No veg items — try All";
  if (diet === "nonveg") return "No non-veg items — try All";
  return "No items found";
}
