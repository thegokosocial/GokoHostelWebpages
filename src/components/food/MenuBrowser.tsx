"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { foodImageSrc } from "@/lib/foodImage";
import {
  type CuratedFilter,
  type DietFilter,
  dietEmptyMessage,
  itemMatchesCurated,
  itemMatchesDiet,
  itemMatchesSearch,
  parseFoodTags,
} from "@/lib/foodMenuFilters";

interface Category {
  id: number;
  name: string;
  nameKannada: string;
  icon: string;
  description: string;
  displayOrder: number;
}

interface MenuItem {
  id: number;
  categoryId: number;
  name: string;
  nameKannada: string;
  description: string;
  price: number;
  priceText: string;
  tags: string;
  ingredients: string;
  imageUrl: string;
  priceOnRequest?: number;
  indicativeMinPrice?: number;
  indicativeMaxPrice?: number;
  priceBasis?: string;
  isAvailable: number;
  displayOrder: number;
  trackInventory?: number;
  stockQuantity?: number;
  lowStockThreshold?: number;
}

export interface CartItem {
  menuItemId: number;
  name: string;
  nameKannada: string;
  price: number;
  priceOnRequest?: number;
  indicativeMinPrice?: number;
  indicativeMaxPrice?: number;
  priceBasis?: string;
  quantity: number;
  imageUrl: string;
}

interface MenuBrowserProps {
  categories: Category[];
  items: MenuItem[];
  cart: CartItem[];
  onAddToCart: (item: CartItem) => void;
  onRemoveFromCart: (menuItemId: number) => void;
}

function formatPrice(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

export function MenuBrowser({ categories, items, cart, onAddToCart, onRemoveFromCart }: MenuBrowserProps) {
  const [dietFilter, setDietFilter] = useState<DietFilter>("all");
  const [curatedFilter, setCuratedFilter] = useState<CuratedFilter>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.displayOrder - b.displayOrder),
    [categories],
  );

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        const tags = parseFoodTags(item.tags);
        return itemMatchesDiet(tags, dietFilter)
          && itemMatchesCurated(tags, curatedFilter)
          && itemMatchesSearch(item, searchQuery);
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [items, dietFilter, curatedFilter, searchQuery]);

  const sections = useMemo(() => {
    const byCat = new Map<number, MenuItem[]>();
    for (const item of filteredItems) {
      const list = byCat.get(item.categoryId) || [];
      list.push(item);
      byCat.set(item.categoryId, list);
    }
    return sortedCategories
      .map((cat) => ({ category: cat, items: byCat.get(cat.id) || [] }))
      .filter((section) => section.items.length > 0);
  }, [filteredItems, sortedCategories]);

  const hasChefSpecial = useMemo(
    () => items.some((i) => parseFoodTags(i.tags).map((t) => t.toLowerCase()).includes("chef-special")),
    [items],
  );
  const hasGokoSpecial = useMemo(
    () => items.some((i) => parseFoodTags(i.tags).map((t) => t.toLowerCase()).includes("goko-special")),
    [items],
  );

  const getCartQuantity = (menuItemId: number): number => {
    const found = cart.find((c) => c.menuItemId === menuItemId);
    return found?.quantity || 0;
  };

  const handleAdd = (item: MenuItem) => {
    onAddToCart({
      menuItemId: item.id,
      name: item.name,
      nameKannada: item.nameKannada || "",
      price: item.price,
      priceOnRequest: item.priceOnRequest,
      indicativeMinPrice: item.indicativeMinPrice,
      indicativeMaxPrice: item.indicativeMaxPrice,
      priceBasis: item.priceBasis,
      quantity: 1,
      imageUrl: item.imageUrl || "",
    });
  };

  const renderItemCard = (item: MenuItem, categoryIcon: string) => {
    const tags = parseFoodTags(item.tags);
    const isUnavailable = item.isAvailable !== 1 || (item.priceOnRequest !== 1 && item.price <= 0);
    const qty = getCartQuantity(item.id);
    const showLowStock = !isUnavailable && item.trackInventory && item.stockQuantity != null && item.lowStockThreshold != null && item.stockQuantity <= item.lowStockThreshold && item.stockQuantity > 0;
    const imageSrc = foodImageSrc(item.imageUrl);

    return (
      <motion.div
        key={item.id}
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        whileTap={isUnavailable ? undefined : { scale: 0.98 }}
        className={`flex flex-col rounded-xl border bg-white dark:bg-card p-1.5 shadow-sm dark:shadow-none transition-all duration-200 sm:rounded-2xl sm:p-2.5 ${
          isUnavailable
            ? "border-gray-100 dark:border-border opacity-50"
            : "border-gray-100 dark:border-border hover:border-brand-green/30 hover:shadow-lg dark:hover:shadow-none"
        }`}
      >
        <div className="h-14 w-full shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-[#1c1c1c] sm:h-20 sm:rounded-xl">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={item.name}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = "none";
                const placeholder = target.nextElementSibling as HTMLElement;
                if (placeholder) placeholder.style.display = "flex";
              }}
            />
          ) : null}
          <div
            className="flex h-full w-full items-center justify-center text-2xl text-gray-400"
            style={{ display: imageSrc ? "none" : "flex" }}
          >
            {categoryIcon || "🍽️"}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between pt-1 sm:pt-1.5">
          <div>
            <h3 className="text-xs font-semibold leading-tight text-gray-800 dark:text-foreground sm:text-sm">
              {item.name}
            </h3>
            {item.nameKannada && (
              <p className="line-clamp-1 text-[10px] text-gray-500 sm:text-xs">{item.nameKannada}</p>
            )}
            {tags.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-0.5">
                {tags.map((tag) => {
                  const lc = tag.toLowerCase();
                  let classes = "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400";
                  if (lc === "veg") classes = "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400";
                  else if (lc === "non-veg" || lc === "nonveg") classes = "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400";
                  else if (lc === "spicy") classes = "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400";
                  else if (lc === "seafood") classes = "bg-brand-green/10 dark:bg-brand-green/20 text-brand-green dark:text-brand-green-dark";
                  else if (lc === "chicken") classes = "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400";
                  else if (lc === "mutton") classes = "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-300";
                  else if (lc === "egg") classes = "bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400";
                  else if (lc === "chef-special") classes = "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400";
                  else if (lc === "goko-special") classes = "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400";
                  const display = lc.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                  return (
                    <span
                      key={tag}
                      className={`whitespace-nowrap rounded-full px-1 py-0.5 text-[9px] font-medium sm:px-2 sm:text-xs ${classes}`}
                    >
                      {display}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-0.5 sm:mt-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-800 dark:text-foreground sm:text-sm">
                {isUnavailable ? (
                  <span className="text-gray-400">Unavailable</span>
                ) : (
                  item.priceOnRequest === 1
                    ? (item.indicativeMinPrice && item.indicativeMaxPrice ? `₹${Math.round(item.indicativeMinPrice / 100)}–₹${Math.round(item.indicativeMaxPrice / 100)} approx. ${item.priceBasis || "per portion"}` : "Check with staff")
                    : formatPrice(item.price)
                )}
              </span>
              {showLowStock && (
                <span className="rounded-full bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-400">
                  {item.stockQuantity} left
                </span>
              )}
            </div>

            {!isUnavailable && (
              <AnimatePresence mode="wait">
                {qty === 0 ? (
                  <motion.button
                    key="add"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => handleAdd(item)}
                    className="goko-gradient-cta rounded-lg px-2 py-1.5 text-[10px] font-semibold text-white shadow-sm transition-shadow hover:shadow-md dark:shadow-none sm:px-3 sm:py-2 sm:text-xs"
                  >
                    Add
                  </motion.button>
                ) : (
                  <motion.div
                    key="stepper"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex items-center gap-0.5 rounded-lg border border-brand-green/25 bg-brand-green/10 px-0.5 py-0.5 dark:border-brand-green/40 dark:bg-brand-green/20 sm:gap-2 sm:px-1.5"
                  >
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={() => onRemoveFromCart(item.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-brand-green transition-colors hover:bg-brand-green/10 sm:h-10 sm:w-10"
                    >
                      −
                    </motion.button>
                    <motion.span
                      key={qty}
                      initial={{ scale: 1.3 }}
                      animate={{ scale: 1 }}
                      className="min-w-[16px] text-center text-sm font-semibold text-brand-green"
                    >
                      {qty}
                    </motion.span>
                    <motion.button
                      whileTap={{ scale: 0.85 }}
                      onClick={() => handleAdd(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-brand-green transition-colors hover:bg-brand-green/10 sm:h-10 sm:w-10"
                    >
                      +
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-0 flex-col px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-4"
    >
      <h2 className="mb-3 text-xl font-bold text-gray-800 dark:text-foreground">Menu</h2>

      <div className="sticky top-[2.75rem] z-20 -mx-3 space-y-2 bg-gray-50/95 px-3 pb-2 pt-1 backdrop-blur-sm dark:bg-background/95 sm:-mx-4 sm:px-4">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dishes…"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-8 text-xs outline-none transition-all duration-200 focus:border-brand-green focus-visible:goko-focus focus:shadow-sm dark:border-border dark:bg-muted dark:text-foreground dark:focus:bg-accent dark:focus:shadow-none sm:text-sm"
          />
          <AnimatePresence>
            {searchQuery && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-gray-300 text-white transition-colors hover:bg-gray-400"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div
          role="group"
          aria-label="Diet filter"
          className="grid grid-cols-3 gap-1.5"
        >
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setDietFilter("all")}
            className={`min-w-0 rounded-full px-2 py-2 text-center text-xs font-medium transition-all duration-200 sm:text-sm ${
              dietFilter === "all"
                ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 shadow-sm dark:shadow-none"
                : "bg-white dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-border"
            }`}
          >
            All
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setDietFilter("veg")}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-medium transition-all duration-200 sm:text-sm ${
              dietFilter === "veg"
                ? "bg-green-600 text-white shadow-sm dark:shadow-none"
                : "bg-white dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-border"
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
            Veg
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setDietFilter("nonveg")}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-medium transition-all duration-200 sm:text-sm ${
              dietFilter === "nonveg"
                ? "bg-red-600 text-white shadow-sm dark:shadow-none"
                : "bg-white dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-border"
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
            Non-veg
          </motion.button>
        </div>

        {(hasChefSpecial || hasGokoSpecial) && (
          <div className="flex flex-wrap gap-1.5">
            {hasChefSpecial && (
              <button
                type="button"
                onClick={() => setCuratedFilter(curatedFilter === "chef-special" ? null : "chef-special")}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition sm:text-xs ${
                  curatedFilter === "chef-special"
                    ? "bg-purple-600 text-white"
                    : "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400"
                }`}
              >
                Chef Special
              </button>
            )}
            {hasGokoSpecial && (
              <button
                type="button"
                onClick={() => setCuratedFilter(curatedFilter === "goko-special" ? null : "goko-special")}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition sm:text-xs ${
                  curatedFilter === "goko-special"
                    ? "bg-indigo-600 text-white"
                    : "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400"
                }`}
              >
                Goko Special
              </button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <AnimatePresence mode="popLayout">
          {sections.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-10 text-center text-sm text-gray-500"
            >
              {dietEmptyMessage(dietFilter)}
            </motion.p>
          ) : (
            <div className="space-y-5">
              {sections.map(({ category, items: sectionItems }) => (
                <section key={category.id} aria-labelledby={`menu-cat-${category.id}`}>
                  <h3
                    id={`menu-cat-${category.id}`}
                    className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-800 dark:text-foreground"
                  >
                    <span aria-hidden>{category.icon}</span>
                    {category.name}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {sectionItems.map((item) => renderItemCard(item, category.icon))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
