import { describe, expect, it } from "vitest";
import {
  type CuratedFilter,
  type DietFilter,
  dietEmptyMessage,
  itemMatchesCurated,
  itemMatchesDiet,
  itemMatchesSearch,
  parseFoodTags,
} from "@/lib/foodMenuFilters";

type CatalogItem = {
  id: number;
  categoryId: number;
  name: string;
  nameKannada?: string | null;
  tags: string;
  displayOrder: number;
};

type CatalogCategory = {
  id: number;
  name: string;
  displayOrder: number;
};

/** Mirrors MenuBrowser section composition for regression without mounting React. */
function buildFilteredSections(
  categories: CatalogCategory[],
  items: CatalogItem[],
  diet: DietFilter,
  curated: CuratedFilter,
  search: string,
) {
  const filtered = items
    .filter((item) => {
      const tags = parseFoodTags(item.tags);
      return itemMatchesDiet(tags, diet)
        && itemMatchesCurated(tags, curated)
        && itemMatchesSearch(item, search);
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const byCat = new Map<number, CatalogItem[]>();
  for (const item of filtered) {
    const list = byCat.get(item.categoryId) || [];
    list.push(item);
    byCat.set(item.categoryId, list);
  }

  return [...categories]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((category) => ({ category, items: byCat.get(category.id) || [] }))
    .filter((section) => section.items.length > 0);
}

const categories: CatalogCategory[] = [
  { id: 1, name: "Snacks", displayOrder: 2 },
  { id: 2, name: "Mains", displayOrder: 1 },
  { id: 3, name: "Empty Cat", displayOrder: 3 },
];

const catalog: CatalogItem[] = [
  { id: 10, categoryId: 2, name: "Veg Thali", nameKannada: "ತಾಳಿ", tags: '["veg","goko-special"]', displayOrder: 2 },
  { id: 11, categoryId: 2, name: "Chicken Curry", tags: '["non-veg","chef-special"]', displayOrder: 1 },
  { id: 12, categoryId: 1, name: "Masala Dosa", tags: '["veg"]', displayOrder: 1 },
  { id: 13, categoryId: 1, name: "Egg Puff", tags: '["nonveg","egg"]', displayOrder: 2 },
  { id: 14, categoryId: 1, name: "Broken Tags", tags: "not-json", displayOrder: 3 },
];

describe("foodMenuFilters", () => {
  it("parses tag JSON and ignores invalid payloads", () => {
    expect(parseFoodTags('["veg","spicy"]')).toEqual(["veg", "spicy"]);
    expect(parseFoodTags("not-json")).toEqual([]);
    expect(parseFoodTags(null)).toEqual([]);
    expect(parseFoodTags('["veg",1,null,"spicy"]')).toEqual(["veg", "spicy"]);
    expect(parseFoodTags("{}")).toEqual([]);
  });

  it("matches diet filters including nonveg aliases", () => {
    expect(itemMatchesDiet(["veg"], "all")).toBe(true);
    expect(itemMatchesDiet(["veg"], "veg")).toBe(true);
    expect(itemMatchesDiet(["veg"], "nonveg")).toBe(false);
    expect(itemMatchesDiet(["non-veg"], "nonveg")).toBe(true);
    expect(itemMatchesDiet(["nonveg"], "nonveg")).toBe(true);
    expect(itemMatchesDiet(["VEG"], "veg")).toBe(true);
    expect(itemMatchesDiet(["Non-Veg"], "nonveg")).toBe(true);
    expect(itemMatchesDiet([], "veg")).toBe(false);
  });

  it("matches curated and search filters", () => {
    expect(itemMatchesCurated(["goko-special"], "goko-special")).toBe(true);
    expect(itemMatchesCurated(["veg"], "goko-special")).toBe(false);
    expect(itemMatchesCurated(["veg"], null)).toBe(true);
    expect(itemMatchesCurated(["Chef-Special"], "chef-special")).toBe(true);
    expect(itemMatchesSearch({ name: "Veg Noodles", nameKannada: "ನೂಡಲ್ಸ್" }, "nood")).toBe(true);
    expect(itemMatchesSearch({ name: "Pizza", nameKannada: "" }, "soup")).toBe(false);
    expect(itemMatchesSearch({ name: "Thali", nameKannada: "ತಾಳಿ" }, "ತಾಳಿ")).toBe(true);
    expect(itemMatchesSearch({ name: "Tea", nameKannada: null }, "  ")).toBe(true);
  });

  it("returns helpful empty-state copy per diet filter", () => {
    expect(dietEmptyMessage("veg")).toContain("veg");
    expect(dietEmptyMessage("nonveg")).toContain("non-veg");
    expect(dietEmptyMessage("all")).toBe("No items found");
  });
});

describe("guest menu filter workflows", () => {
  it("keeps category display order and drops empty categories for All", () => {
    const sections = buildFilteredSections(categories, catalog, "all", null, "");
    expect(sections.map((s) => s.category.name)).toEqual(["Mains", "Snacks"]);
    expect(sections[0].items.map((i) => i.name)).toEqual(["Chicken Curry", "Veg Thali"]);
    expect(sections[1].items.map((i) => i.name)).toEqual(["Masala Dosa", "Egg Puff", "Broken Tags"]);
  });

  it("veg filter hides non-veg aliases and untagged broken payloads", () => {
    const sections = buildFilteredSections(categories, catalog, "veg", null, "");
    expect(sections.flatMap((s) => s.items.map((i) => i.name))).toEqual(["Veg Thali", "Masala Dosa"]);
  });

  it("non-veg filter accepts both non-veg and nonveg tags", () => {
    const sections = buildFilteredSections(categories, catalog, "nonveg", null, "");
    expect(sections.flatMap((s) => s.items.map((i) => i.name))).toEqual(["Chicken Curry", "Egg Puff"]);
  });

  it("stacks curated special with diet and search", () => {
    const chefOnly = buildFilteredSections(categories, catalog, "nonveg", "chef-special", "");
    expect(chefOnly.flatMap((s) => s.items.map((i) => i.name))).toEqual(["Chicken Curry"]);

    const gokoSearch = buildFilteredSections(categories, catalog, "veg", "goko-special", "thali");
    expect(gokoSearch.flatMap((s) => s.items.map((i) => i.name))).toEqual(["Veg Thali"]);

    const noMatch = buildFilteredSections(categories, catalog, "veg", "chef-special", "");
    expect(noMatch).toEqual([]);
    expect(dietEmptyMessage("veg")).toMatch(/try All/i);
  });

  it("search narrows across English names without inventing sections", () => {
    const sections = buildFilteredSections(categories, catalog, "all", null, "puff");
    expect(sections).toHaveLength(1);
    expect(sections[0].category.name).toBe("Snacks");
    expect(sections[0].items.map((i) => i.name)).toEqual(["Egg Puff"]);
  });
});
