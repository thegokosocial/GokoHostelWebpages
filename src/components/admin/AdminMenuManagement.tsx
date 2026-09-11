"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLoading } from "./AdminLoading";
import { cn } from "@/lib/utils";
import {
  PlusIcon, Trash2Icon, PencilIcon, CheckIcon, XIcon,
  ChevronDownIcon, ToggleLeftIcon, ToggleRightIcon, PackagePlusIcon,
  LayoutListIcon, TableIcon,
} from "lucide-react";
import { hasPermission, type Role } from "./types";
import { useAdminToast } from "@/components/admin/AdminToast";
import { SiteImageField } from "./SiteImageField";
import { foodImageSrc } from "@/lib/foodImage";

type Category = {
  id: number;
  name: string;
  nameKannada: string;
  icon: string;
  description: string;
  displayOrder: number;
  isActive: number;
  itemCount: number;
  trackInventoryDefault: number;
  discountExempt: number;
};

type MenuItem = {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  nameKannada: string;
  description: string;
  price: number;
  priceText: string;
  tags: string;
  ingredients: string;
  imageUrl: string;
  isAvailable: number;
  displayOrder: number;
  trackInventory: number;
  stockQuantity: number;
  lowStockThreshold: number;
};

type CategoryForm = {
  name: string;
  nameKannada: string;
  icon: string;
  description: string;
  displayOrder: string;
  trackInventoryDefault: boolean;
  discountExempt: boolean;
};

type ItemForm = {
  categoryId: string;
  name: string;
  nameKannada: string;
  description: string;
  priceDisplay: string;
  priceText: string;
  tagVeg: boolean;
  tagNonVeg: boolean;
  tagSpicy: boolean;
  tagSeafood: boolean;
  tagChicken: boolean;
  tagMutton: boolean;
  tagEgg: boolean;
  tagChefSpecial: boolean;
  tagGokoSpecial: boolean;
  customTags: string[];
  ingredients: string;
  imageUrl: string;
  displayOrder: string;
  trackInventory: boolean;
  stockQuantity: string;
  lowStockThreshold: string;
};

const emptyCategoryForm: CategoryForm = { name: "", nameKannada: "", icon: "🍽️", description: "", displayOrder: "0", trackInventoryDefault: false, discountExempt: false };
const emptyItemForm: ItemForm = {
  categoryId: "", name: "", nameKannada: "", description: "",
  priceDisplay: "", priceText: "", tagVeg: false, tagNonVeg: false, tagSpicy: false,
  tagSeafood: false, tagChicken: false, tagMutton: false, tagEgg: false,
  tagChefSpecial: false, tagGokoSpecial: false, customTags: [],
  ingredients: "", imageUrl: "", displayOrder: "0",
  trackInventory: false, stockQuantity: "0", lowStockThreshold: "5",
};

function parseTags(tagsJson: string): string[] {
  try { return JSON.parse(tagsJson); } catch { return []; }
}
function parseIngredients(ingredientsJson: string): string[] {
  try { return JSON.parse(ingredientsJson); } catch { return []; }
}
function pricePaiseToDisplay(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}
function priceDisplayToPaise(display: string): number {
  const num = parseFloat(display.replace(/[^\d.]/g, ""));
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

export function AdminMenuManagement({ password, username, role, permissions = {} }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean> }) {
  const canManageCategories = hasPermission(role, permissions, "canManageMenuCategories");
  const canManageItems = hasPermission(role, permissions, "canManageMenuItems");
  const canToggleAvailability = hasPermission(role, permissions, "canToggleMenuAvailability");
  const canManageInventory = hasPermission(role, permissions, "canManageInventory");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>({ ...emptyCategoryForm });
  const categoryFormRef = useRef<HTMLDivElement>(null);

  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>({ ...emptyItemForm });
  const itemFormRef = useRef<HTMLDivElement>(null);
  const [addStockItemId, setAddStockItemId] = useState<number | null>(null);
  const [addStockQty, setAddStockQty] = useState("");
  const [itemViewMode, setItemViewMode] = useState<"card" | "table">(() => typeof window !== "undefined" && window.innerWidth < 1024 ? "card" : "table");
  const [expandedItemCard, setExpandedItemCard] = useState<number | null>(null);
  const scrollBackCatId = useRef<number | null>(null);
  const scrollBackItemId = useRef<number | null>(null);

  const { showError, showSuccess } = useAdminToast();

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const loadCategories = useCallback(async () => {
    const res = await apiCall({ action: "getCategories" });
    if (res.ok) {
      const data = await res.json();
      setCategories(data.categories || []);
    }
  }, [apiCall]);

  const loadItems = useCallback(async () => {
    const res = await apiCall({ action: "getMenuItems" });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
    }
  }, [apiCall]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadCategories(), loadItems()]);
    } finally {
      setLoading(false);
    }
  }, [loadCategories, loadItems]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // --- Category CRUD ---
  const openAddCategory = () => {
    setCategoryForm({ ...emptyCategoryForm });
    setEditingCategoryId(null);
    setShowCategoryForm(true);
    setTimeout(() => categoryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const openEditCategory = (cat: Category) => {
    setCategoryForm({
      name: cat.name,
      nameKannada: cat.nameKannada || "",
      icon: cat.icon,
      description: cat.description || "",
      displayOrder: String(cat.displayOrder),
      trackInventoryDefault: !!cat.trackInventoryDefault,
      discountExempt: !!cat.discountExempt,
    });
    setEditingCategoryId(cat.id);
    setShowCategoryForm(true);
    setTimeout(() => categoryFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const saveCategory = async () => {
    if (!categoryForm.name.trim()) { showError("Name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: categoryForm.name.trim(),
        nameKannada: categoryForm.nameKannada.trim(),
        icon: categoryForm.icon.trim() || "🍽️",
        description: categoryForm.description.trim(),
        displayOrder: parseInt(categoryForm.displayOrder) || 0,
        trackInventoryDefault: categoryForm.trackInventoryDefault ? 1 : 0,
        discountExempt: categoryForm.discountExempt ? 1 : 0,
      };
      const res = editingCategoryId
        ? await apiCall({ action: "updateCategory", id: editingCategoryId, ...payload })
        : await apiCall({ action: "addCategory", ...payload });
      if (res.ok) {
        if (editingCategoryId) scrollBackCatId.current = editingCategoryId;
        setShowCategoryForm(false);
        await loadAll();
        if (scrollBackCatId.current) {
          const id = scrollBackCatId.current; scrollBackCatId.current = null;
          setTimeout(() => { const el = document.querySelector(`[data-cat-id="${id}"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 200);
        }
      } else {
        const d = await res.json();
        showError("Failed to save", d.error);
      }
    } finally { setSaving(false); }
  };

  const deleteCategory = async (id: number, name: string) => {
    if (!confirm(`Delete category "${name}" and ALL its items? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const res = await apiCall({ action: "deleteCategory", id });
      if (res.ok) {
        if (selectedCategoryId === id) setSelectedCategoryId(null);
        await loadAll();
      } else {
        const d = await res.json();
        showError("Failed to delete", d.error);
      }
    } finally { setSaving(false); }
  };

  const toggleCategoryActive = async (cat: Category) => {
    setSaving(true);
    try {
      await apiCall({ action: "toggleCategoryAvailability", id: cat.id, isActive: cat.isActive ? 0 : 1 });
      await loadCategories();
    } finally { setSaving(false); }
  };

  // --- Item CRUD ---
  const openAddItem = () => {
    const catId = selectedCategoryId || categories[0]?.id;
    const cat = categories.find((c) => c.id === catId);
    setItemForm({
      ...emptyItemForm,
      categoryId: catId ? String(catId) : "",
      trackInventory: !!cat?.trackInventoryDefault,
    });
    setEditingItemId(null);
    setShowItemForm(true);
    setTimeout(() => itemFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const openEditItem = (item: MenuItem) => {
    const tags = parseTags(item.tags);
    const predefinedKeys = ["veg", "non-veg", "spicy", "seafood", "chicken", "mutton", "egg", "chef-special", "goko-special"];
    const custom = tags.filter((t) => !predefinedKeys.includes(t.toLowerCase()));
    setItemForm({
      categoryId: String(item.categoryId),
      name: item.name,
      nameKannada: item.nameKannada || "",
      description: item.description || "",
      priceDisplay: pricePaiseToDisplay(item.price),
      priceText: item.priceText || "",
      tagVeg: tags.includes("veg"),
      tagNonVeg: tags.includes("non-veg"),
      tagSpicy: tags.includes("spicy"),
      tagSeafood: tags.includes("seafood"),
      tagChicken: tags.includes("chicken"),
      tagMutton: tags.includes("mutton"),
      tagEgg: tags.includes("egg"),
      tagChefSpecial: tags.includes("chef-special"),
      tagGokoSpecial: tags.includes("goko-special"),
      customTags: custom,
      ingredients: parseIngredients(item.ingredients).join(", "),
      imageUrl: item.imageUrl || "",
      displayOrder: String(item.displayOrder),
      trackInventory: !!item.trackInventory,
      stockQuantity: String(item.stockQuantity || 0),
      lowStockThreshold: String(item.lowStockThreshold || 5),
    });
    setEditingItemId(item.id);
    setShowItemForm(true);
    setTimeout(() => itemFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const saveItem = async () => {
    if (!itemForm.name.trim()) { showError("Name is required"); return; }
    if (!itemForm.categoryId) { showError("Select a category"); return; }
    const pricePaise = priceDisplayToPaise(itemForm.priceDisplay);
    if (pricePaise <= 0) { showError("Enter a valid price"); return; }

    setSaving(true);
    try {
      const tags: string[] = [];
      if (itemForm.tagVeg) tags.push("veg");
      if (itemForm.tagNonVeg) tags.push("non-veg");
      if (itemForm.tagSpicy) tags.push("spicy");
      if (itemForm.tagSeafood) tags.push("seafood");
      if (itemForm.tagChicken) tags.push("chicken");
      if (itemForm.tagMutton) tags.push("mutton");
      if (itemForm.tagEgg) tags.push("egg");
      if (itemForm.tagChefSpecial) tags.push("chef-special");
      if (itemForm.tagGokoSpecial) tags.push("goko-special");
      tags.push(...itemForm.customTags);

      const ingredientsArr = itemForm.ingredients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        categoryId: parseInt(itemForm.categoryId),
        name: itemForm.name.trim(),
        nameKannada: itemForm.nameKannada.trim(),
        description: itemForm.description.trim(),
        price: pricePaise,
        priceText: itemForm.priceText.trim(),
        tags: JSON.stringify(tags),
        ingredients: JSON.stringify(ingredientsArr),
        imageUrl: itemForm.imageUrl,
        displayOrder: parseInt(itemForm.displayOrder) || 0,
        trackInventory: itemForm.trackInventory ? 1 : 0,
        stockQuantity: parseInt(itemForm.stockQuantity) || 0,
        lowStockThreshold: parseInt(itemForm.lowStockThreshold) || 5,
      };

      const res = editingItemId
        ? await apiCall({ action: "updateMenuItem", id: editingItemId, ...payload })
        : await apiCall({ action: "addMenuItem", ...payload });
      if (res.ok) {
        if (editingItemId) scrollBackItemId.current = editingItemId;
        setShowItemForm(false);
        await loadItems();
        if (scrollBackItemId.current) {
          const id = scrollBackItemId.current; scrollBackItemId.current = null;
          setTimeout(() => { const el = document.querySelector(`[data-item-id="${id}"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 200);
        }
      } else {
        const d = await res.json();
        showError("Failed to save", d.error);
      }
    } finally { setSaving(false); }
  };

  const deleteItem = async (id: number, name: string) => {
    if (!confirm(`Delete menu item "${name}"?`)) return;
    setSaving(true);
    try {
      const res = await apiCall({ action: "deleteMenuItem", id });
      if (res.ok) await loadItems();
      else { const d = await res.json(); showError("Failed to delete", d.error); }
    } finally { setSaving(false); }
  };

  const toggleItemAvailability = async (item: MenuItem) => {
    setSaving(true);
    try {
      await apiCall({ action: "toggleItemAvailability", id: item.id, isAvailable: !item.isAvailable });
      await loadItems();
    } finally { setSaving(false); }
  };

  const bulkToggle = async (categoryId: number, available: boolean) => {
    setSaving(true);
    try {
      await apiCall({ action: "bulkToggleAvailability", categoryId, isAvailable: available });
      await loadItems();
    } finally { setSaving(false); }
  };

  const handleAddStock = async (menuItemId: number) => {
    const qty = parseInt(addStockQty);
    if (!qty || qty < 1) { showError("Enter a valid quantity"); return; }
    setSaving(true);
    try {
      const res = await apiCall({ action: "addStock", menuItemId, quantity: qty });
      if (res.ok) {
        setAddStockItemId(null);
        setAddStockQty("");
        await loadItems();
      } else {
        const d = await res.json();
        showError("Failed to add stock", d.error);
      }
    } finally { setSaving(false); }
  };

  const filteredItems = selectedCategoryId
    ? items.filter((i) => i.categoryId === selectedCategoryId)
    : items;

  if (loading) return <AdminLoading message="Loading menu..." />;

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Menu Management</h2>
      <p className="mt-1 text-sm text-brand-green-dark/60">Manage food categories and menu items.</p>

      {/* ---- CATEGORIES SECTION ---- */}
      <div className="mt-6 rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-brand-green-dark">Categories</h3>
          {canManageCategories && (
            <Button type="button" variant="cta" size="sm" onClick={openAddCategory} disabled={saving}>
              <PlusIcon className="mr-1 h-4 w-4" /> Add Category
            </Button>
          )}
        </div>

        {/* Category Form (Add/Edit) */}
        {showCategoryForm && (
          <div ref={categoryFormRef} className="mt-4 rounded-xl border border-brand-green/20 bg-brand-green/5 p-4">
            <h4 className="text-sm font-semibold text-brand-green-dark">
              {editingCategoryId ? "Edit Category" : "Add Category"}
            </h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <Label className="text-xs">Name (English)</Label>
                <Input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="e.g. Breakfast" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Name (Kannada)</Label>
                <Input value={categoryForm.nameKannada} onChange={(e) => setCategoryForm({ ...categoryForm, nameKannada: e.target.value })} placeholder="e.g. ಉಪಹಾರ" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Icon (emoji)</Label>
                <Input value={categoryForm.icon} onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value })} placeholder="🍽️" className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} placeholder="Optional description" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Display Order</Label>
                <Input type="number" value={categoryForm.displayOrder} onChange={(e) => setCategoryForm({ ...categoryForm, displayOrder: e.target.value })} className="mt-1" />
              </div>
              {canManageInventory && <div className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" id="catTrackInv" checked={categoryForm.trackInventoryDefault} onChange={(e) => setCategoryForm({ ...categoryForm, trackInventoryDefault: e.target.checked })} className="rounded" />
                <Label htmlFor="catTrackInv" className="text-xs cursor-pointer">Default Inventory Tracking — new items auto-enable inventory</Label>
              </div>}
              <div className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" id="catDiscExempt" checked={categoryForm.discountExempt} onChange={(e) => setCategoryForm({ ...categoryForm, discountExempt: e.target.checked })} className="rounded" />
                <Label htmlFor="catDiscExempt" className="text-xs cursor-pointer">Exempt from Discounts — items in this category won&apos;t be discounted when applying bill discounts</Label>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" size="sm" onClick={saveCategory} disabled={saving}>
                <CheckIcon className="mr-1 h-3.5 w-3.5" /> {editingCategoryId ? "Update" : "Add"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCategoryForm(false)}>
                <XIcon className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Category List */}
        {categories.length === 0 ? (
          <p className="mt-4 py-6 text-center text-sm text-brand-green-dark/50">No categories yet. Add one to get started.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                data-cat-id={cat.id}
                className={cn(
                  "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border px-4 py-3 transition-colors",
                  selectedCategoryId === cat.id
                    ? "border-brand-green/30 bg-brand-green/5"
                    : "border-brand-mist bg-white dark:bg-card hover:bg-brand-sand/30",
                  !cat.isActive && "opacity-60"
                )}
              >
                <button
                  type="button"
                  className="flex flex-1 items-center gap-3 text-left"
                  onClick={() => setSelectedCategoryId(selectedCategoryId === cat.id ? null : cat.id)}
                >
                  <span className="text-xl">{cat.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-brand-green-dark">{cat.name}</span>
                      {cat.nameKannada && <span className="text-xs text-brand-green-dark/50">({cat.nameKannada})</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-brand-green-dark/50">
                      {cat.description && <span>{cat.description}</span>}
                      <span>{cat.itemCount} items</span>
                      <span className="text-[10px]">Order: {cat.displayOrder}</span>
                    </div>
                  </div>
                </button>
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    cat.isActive ? "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-500 dark:text-gray-400"
                  )}>
                    {cat.isActive ? "Active" : "Inactive"}
                  </span>
                  {!!cat.discountExempt && (
                    <span className="rounded-full bg-purple-100 dark:bg-purple-900/50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-400">
                      No Discount
                    </span>
                  )}
                  {canToggleAvailability && <button type="button" onClick={() => toggleCategoryActive(cat)} className="rounded p-1 text-brand-green-dark/40 hover:bg-brand-sand/50 hover:text-brand-green-dark" title="Toggle active">
                    {cat.isActive ? <ToggleRightIcon className="h-4 w-4 text-green-600" /> : <ToggleLeftIcon className="h-4 w-4" />}
                  </button>}
                  {canManageCategories && <button type="button" onClick={() => openEditCategory(cat)} className="rounded p-1 text-brand-green-dark/40 hover:bg-brand-sand/50 hover:text-brand-green-dark" title="Edit">
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>}
                  {canManageCategories && <button type="button" onClick={() => deleteCategory(cat.id, cat.name)} className="rounded p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600" title="Delete">
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- ITEMS SECTION ---- */}
      <div className="mt-6 rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-card dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-base font-bold text-brand-green-dark">Menu Items</h3>
            {categories.length > 0 && (
              <div className="relative">
                <select
                  value={selectedCategoryId ?? ""}
                  onChange={(e) => setSelectedCategoryId(e.target.value ? parseInt(e.target.value) : null)}
                  className="rounded-lg border border-brand-mist bg-white dark:bg-card py-1.5 pl-3 pr-8 text-xs font-medium text-brand-green-dark appearance-none"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-green-dark/40" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedCategoryId && canToggleAvailability && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => bulkToggle(selectedCategoryId, true)} disabled={saving}>
                  Mark all available
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => bulkToggle(selectedCategoryId, false)} disabled={saving}>
                  Mark all unavailable
                </Button>
              </>
            )}
            {canManageItems && <Button type="button" size="sm" onClick={openAddItem} disabled={saving || categories.length === 0}>
              <PlusIcon className="mr-1 h-4 w-4" /> Add Item
            </Button>}
            <div className="flex rounded-lg border border-brand-mist bg-white dark:bg-card p-0.5">
              <button type="button" onClick={() => setItemViewMode("card")} className={cn("rounded-md p-1.5 transition-colors", itemViewMode === "card" ? "bg-brand-green text-white" : "text-brand-green-dark/50 hover:bg-brand-sand")} title="Card view">
                <LayoutListIcon className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setItemViewMode("table")} className={cn("rounded-md p-1.5 transition-colors", itemViewMode === "table" ? "bg-brand-green text-white" : "text-brand-green-dark/50 hover:bg-brand-sand")} title="Table view">
                <TableIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Item Form (Add/Edit) */}
        {showItemForm && (
          <div ref={itemFormRef} className="mt-4 rounded-xl border border-brand-green/20 bg-brand-green/5 p-4">
            <h4 className="text-sm font-semibold text-brand-green-dark">
              {editingItemId ? "Edit Item" : "Add Item"}
            </h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <Label className="text-xs">Category</Label>
                <select
                  value={itemForm.categoryId}
                  onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Name (English)</Label>
                <Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="e.g. Masala Dosa" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Name (Kannada)</Label>
                <Input value={itemForm.nameKannada} onChange={(e) => setItemForm({ ...itemForm, nameKannada: e.target.value })} placeholder="e.g. ಮಸಾಲ ದೋಸೆ" className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} placeholder="Optional description" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Price (₹)</Label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-brand-green-dark/50">₹</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemForm.priceDisplay}
                    onChange={(e) => setItemForm({ ...itemForm, priceDisplay: e.target.value })}
                    placeholder="150"
                    className="pl-7"
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-brand-green-dark/40">
                  Stored as {priceDisplayToPaise(itemForm.priceDisplay)} paise
                </p>
              </div>
              <div>
                <Label className="text-xs">Price Text (optional)</Label>
                <Input value={itemForm.priceText} onChange={(e) => setItemForm({ ...itemForm, priceText: e.target.value })} placeholder="e.g. per plate" className="mt-1" />
              </div>
              <div className="sm:col-span-2 md:col-span-3">
                <SiteImageField
                  label="Item photo"
                  value={foodImageSrc(itemForm.imageUrl)}
                  kind="food"
                  folder="menu"
                  password={password}
                  username={username}
                  onChange={(imageUrl) => setItemForm((current) => ({ ...current, imageUrl }))}
                  onBusy={setImageBusy}
                  disabled={saving}
                />
              </div>
              <div className="sm:col-span-2 md:col-span-3">
                <Label className="text-xs">Tags</Label>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagVeg} onChange={(e) => setItemForm({ ...itemForm, tagVeg: e.target.checked })} className="rounded" />
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" /> Veg
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagNonVeg} onChange={(e) => setItemForm({ ...itemForm, tagNonVeg: e.target.checked })} className="rounded" />
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" /> Non-Veg
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagSpicy} onChange={(e) => setItemForm({ ...itemForm, tagSpicy: e.target.checked })} className="rounded" />
                    🌶️ Spicy
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagSeafood} onChange={(e) => setItemForm({ ...itemForm, tagSeafood: e.target.checked })} className="rounded" />
                    🐟 Seafood
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagChicken} onChange={(e) => setItemForm({ ...itemForm, tagChicken: e.target.checked })} className="rounded" />
                    🍗 Chicken
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagMutton} onChange={(e) => setItemForm({ ...itemForm, tagMutton: e.target.checked })} className="rounded" />
                    🍖 Mutton
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagEgg} onChange={(e) => setItemForm({ ...itemForm, tagEgg: e.target.checked })} className="rounded" />
                    🥚 Egg
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagChefSpecial} onChange={(e) => setItemForm({ ...itemForm, tagChefSpecial: e.target.checked })} className="rounded" />
                    👨‍🍳 Chef Special
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={itemForm.tagGokoSpecial} onChange={(e) => setItemForm({ ...itemForm, tagGokoSpecial: e.target.checked })} className="rounded" />
                    ⭐ Goko Special
                  </label>
                </div>
                {/* Custom tags */}
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Add custom tag…"
                      className="w-full sm:max-w-[200px] text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const val = e.currentTarget.value.trim().toLowerCase().replace(/\s+/g, "-");
                          if (val && !itemForm.customTags.includes(val)) {
                            setItemForm({ ...itemForm, customTags: [...itemForm.customTags, val] });
                          }
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                    <span className="text-[10px] text-brand-green-dark/40">Press Enter to add</span>
                  </div>
                  {itemForm.customTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {itemForm.customTags.map((tag) => (
                        <span key={tag} className="flex items-center gap-1 rounded-full bg-gray-100 dark:bg-[#1c1c1c] px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                          {tag}
                          <button
                            type="button"
                            onClick={() => setItemForm({ ...itemForm, customTags: itemForm.customTags.filter((t) => t !== tag) })}
                            className="ml-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500"
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Ingredients (comma-separated)</Label>
                <Input value={itemForm.ingredients} onChange={(e) => setItemForm({ ...itemForm, ingredients: e.target.value })} placeholder="e.g. rice, lentils, spices" className="mt-1" />
              </div>
              <div>
                <Label className="text-[10px] text-brand-green-dark/50">Display Order</Label>
                <Input type="number" value={itemForm.displayOrder} onChange={(e) => setItemForm({ ...itemForm, displayOrder: e.target.value })} className="mt-1 text-xs" />
                <p className="mt-0.5 text-[10px] text-brand-green-dark/40">Optional. Items with 0 display in default order.</p>
              </div>
              {/* Inventory Tracking */}
              {canManageInventory && <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-brand-mist bg-brand-sand/20 p-3">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input type="checkbox" checked={itemForm.trackInventory} onChange={(e) => setItemForm({ ...itemForm, trackInventory: e.target.checked })} className="rounded" />
                  Track Inventory
                </label>
                {itemForm.trackInventory && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Stock Quantity</Label>
                      <Input type="number" min="0" value={itemForm.stockQuantity} onChange={(e) => setItemForm({ ...itemForm, stockQuantity: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Low Stock Threshold</Label>
                      <Input type="number" min="0" value={itemForm.lowStockThreshold} onChange={(e) => setItemForm({ ...itemForm, lowStockThreshold: e.target.value })} className="mt-1" />
                    </div>
                  </div>
                )}
              </div>}
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" size="sm" onClick={saveItem} disabled={saving || imageBusy}>
                <CheckIcon className="mr-1 h-3.5 w-3.5" /> {editingItemId ? "Update" : "Add"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowItemForm(false)}>
                <XIcon className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Item List */}
        {categories.length === 0 ? (
          <p className="mt-4 py-6 text-center text-sm text-brand-green-dark/50">Add a category first to manage items.</p>
        ) : filteredItems.length === 0 ? (
          <p className="mt-4 py-6 text-center text-sm text-brand-green-dark/50">
            {selectedCategoryId ? "No items in this category." : "No menu items yet."}
          </p>
        ) : (
          <>
            {/* Card View */}
            {itemViewMode === "card" && (
              <div className="mt-4 space-y-2">
                {filteredItems.map((item) => {
                  const tags = parseTags(item.tags);
                  const isLowStock = item.trackInventory && item.stockQuantity <= item.lowStockThreshold;
                  const isZeroStock = item.trackInventory && item.stockQuantity === 0;
                  const isExpanded = expandedItemCard === item.id;
                  return (
                    <div key={item.id} data-item-id={item.id} className={cn("rounded-xl border border-brand-mist bg-white dark:bg-card shadow-sm dark:shadow-none", !item.isAvailable && "opacity-60")}>
                      <button
                        type="button"
                        onClick={() => setExpandedItemCard(isExpanded ? null : item.id)}
                        className="flex w-full items-start justify-between gap-2 p-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-brand-green-dark">{item.name}</span>
                            <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-bold text-brand-green-dark">₹{pricePaiseToDisplay(item.price)}</span>
                            <span className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                              item.isAvailable ? "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-500 dark:text-gray-400"
                            )}>
                              {item.isAvailable ? "Available" : "Unavailable"}
                            </span>
                            {!!item.trackInventory && (
                              <span className={cn(
                                "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                                isZeroStock ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400" :
                                isLowStock ? "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400" :
                                "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400"
                              )}>
                                {item.stockQuantity} in stock
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-green-dark/60">
                            <span>{item.categoryName}</span>
                            {item.nameKannada && <span>{item.nameKannada}</span>}
                          </div>
                        </div>
                        <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-brand-green-dark/40 transition-transform mt-1", isExpanded && "rotate-180")} />
                      </button>

                      {isExpanded && (
                        <div className="border-t border-brand-mist px-3 pb-3 pt-2">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div><span className="text-brand-green-dark/50">Category:</span> <span className="text-brand-green-dark">{item.categoryName}</span></div>
                            <div><span className="text-brand-green-dark/50">Price:</span> <span className="font-medium text-brand-green-dark">₹{pricePaiseToDisplay(item.price)}{item.priceText ? ` ${item.priceText}` : ""}</span></div>
                            {item.description && <div className="col-span-2"><span className="text-brand-green-dark/50">Description:</span> <span className="text-brand-green-dark">{item.description}</span></div>}
                            <div><span className="text-brand-green-dark/50">Order:</span> <span className="text-brand-green-dark">{item.displayOrder}</span></div>
                            {!!item.trackInventory && <div><span className="text-brand-green-dark/50">Stock:</span> <span className="text-brand-green-dark">{item.stockQuantity} (low: {item.lowStockThreshold})</span></div>}
                          </div>

                          {tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {tags.map((tag) => {
                                const lc = tag.toLowerCase();
                                let classes = "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400";
                                if (lc === "veg") classes = "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400";
                                else if (lc === "non-veg") classes = "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400";
                                else if (lc === "spicy") classes = "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400";
                                else if (lc === "seafood") classes = "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400";
                                else if (lc === "chicken") classes = "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400";
                                else if (lc === "mutton") classes = "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300";
                                else if (lc === "egg") classes = "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400";
                                else if (lc === "chef-special") classes = "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400";
                                else if (lc === "goko-special") classes = "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400";
                                const display = lc.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                                return (
                                  <span key={tag} className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${classes}`}>
                                    {display}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-brand-mist pt-2">
                            {canManageInventory && item.trackInventory && (
                              addStockItemId === item.id ? (
                                <div className="flex items-center gap-1">
                                  <Input type="number" min="1" value={addStockQty} onChange={(e) => setAddStockQty(e.target.value)} className="h-7 w-16 text-xs" placeholder="Qty" autoFocus />
                                  <button type="button" onClick={() => handleAddStock(item.id)} className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950" title="Confirm" disabled={saving}>
                                    <CheckIcon className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" onClick={() => { setAddStockItemId(null); setAddStockQty(""); }} className="rounded p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5" title="Cancel">
                                    <XIcon className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => { setAddStockItemId(item.id); setAddStockQty(""); }} className="flex items-center gap-1 rounded-lg bg-green-50 dark:bg-green-950 px-2 py-1 text-[10px] font-medium text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50">
                                  <PackagePlusIcon className="h-3 w-3" /> Add Stock
                                </button>
                              )
                            )}
                            {canToggleAvailability && <button type="button" onClick={() => toggleItemAvailability(item)} className="flex items-center gap-1 rounded-lg bg-brand-sand px-2 py-1 text-[10px] font-medium text-brand-green-dark/70 hover:bg-brand-green/10">
                              {item.isAvailable ? <ToggleRightIcon className="h-3 w-3 text-green-600" /> : <ToggleLeftIcon className="h-3 w-3" />}
                              {item.isAvailable ? "Mark Unavailable" : "Mark Available"}
                            </button>}
                            {canManageItems && <button type="button" onClick={() => openEditItem(item)} className="flex items-center gap-1 rounded-lg bg-brand-sand px-2 py-1 text-[10px] font-medium text-brand-green-dark/70 hover:bg-brand-green/10">
                              <PencilIcon className="h-3 w-3" /> Edit
                            </button>}
                            {canManageItems && <button type="button" onClick={() => deleteItem(item.id, item.name)} className="flex items-center gap-1 rounded-lg bg-red-50 dark:bg-red-950 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-900/50">
                              <Trash2Icon className="h-3 w-3" /> Delete
                            </button>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Table View */}
            {itemViewMode === "table" && (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-brand-mist bg-brand-sand/50">
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Item</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Category</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70 text-right">Price</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Tags</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Status</th>
                      <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const tags = parseTags(item.tags);
                      const isLowStock = item.trackInventory && item.stockQuantity <= item.lowStockThreshold;
                      const isZeroStock = item.trackInventory && item.stockQuantity === 0;
                      return (
                        <tr key={item.id} data-item-id={item.id} className={cn("border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30", !item.isAvailable && "opacity-60")}>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-brand-green-dark">{item.name}</span>
                              {item.trackInventory ? (
                                <span className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                                  isZeroStock ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400" :
                                  isLowStock ? "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400" :
                                  "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400"
                                )}>
                                  {item.stockQuantity} in stock
                                </span>
                              ) : null}
                            </div>
                            {item.nameKannada && <div className="text-xs text-brand-green-dark/50">{item.nameKannada}</div>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/60">{item.categoryName}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-brand-green-dark">
                            ₹{pricePaiseToDisplay(item.price)}
                            {item.priceText && <span className="ml-1 text-[10px] font-normal text-brand-green-dark/40">{item.priceText}</span>}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {tags.map((tag) => {
                                const lc = tag.toLowerCase();
                                let classes = "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400";
                                if (lc === "veg") classes = "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400";
                                else if (lc === "non-veg") classes = "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400";
                                else if (lc === "spicy") classes = "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400";
                                else if (lc === "seafood") classes = "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400";
                                else if (lc === "chicken") classes = "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400";
                                else if (lc === "mutton") classes = "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300";
                                else if (lc === "egg") classes = "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400";
                                else if (lc === "chef-special") classes = "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400";
                                else if (lc === "goko-special") classes = "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400";
                                const display = lc.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                                return (
                                  <span key={tag} className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${classes}`}>
                                    {display}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              item.isAvailable ? "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-500 dark:text-gray-400"
                            )}>
                              {item.isAvailable ? "Available" : "Unavailable"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canManageInventory && item.trackInventory && (
                                addStockItemId === item.id ? (
                                  <div className="flex items-center gap-1">
                                    <Input type="number" min="1" value={addStockQty} onChange={(e) => setAddStockQty(e.target.value)} className="h-7 w-16 text-xs" placeholder="Qty" autoFocus />
                                    <button type="button" onClick={() => handleAddStock(item.id)} className="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-950" title="Confirm" disabled={saving}>
                                      <CheckIcon className="h-3.5 w-3.5" />
                                    </button>
                                    <button type="button" onClick={() => { setAddStockItemId(null); setAddStockQty(""); }} className="rounded p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5" title="Cancel">
                                      <XIcon className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => { setAddStockItemId(item.id); setAddStockQty(""); }} className="rounded p-1 text-brand-green-dark/40 hover:bg-green-50 dark:hover:bg-green-950 hover:text-green-600" title="Add Stock">
                                    <PackagePlusIcon className="h-3.5 w-3.5" />
                                  </button>
                                )
                              )}
                              {canToggleAvailability && <button type="button" onClick={() => toggleItemAvailability(item)} className="rounded p-1 text-brand-green-dark/40 hover:bg-brand-sand/50 hover:text-brand-green-dark" title="Toggle availability">
                                {item.isAvailable ? <ToggleRightIcon className="h-4 w-4 text-green-600" /> : <ToggleLeftIcon className="h-4 w-4" />}
                              </button>}
                              {canManageItems && <button type="button" onClick={() => openEditItem(item)} className="rounded p-1 text-brand-green-dark/40 hover:bg-brand-sand/50 hover:text-brand-green-dark" title="Edit">
                                <PencilIcon className="h-3.5 w-3.5" />
                              </button>}
                              {canManageItems && <button type="button" onClick={() => deleteItem(item.id, item.name)} className="rounded p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600" title="Delete">
                                <Trash2Icon className="h-3.5 w-3.5" />
                              </button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
