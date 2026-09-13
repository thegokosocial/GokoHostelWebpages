"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { foodImageSrc } from "@/lib/foodImage";
import { usePanelHistory } from "@/hooks/usePanelHistory";

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

type DietFilter = "all" | "veg" | "nonveg";
type CuratedFilter = "chef-special" | "goko-special" | null;

function parseTags(tagsStr: string): string[] {
  try {
    const parsed = JSON.parse(tagsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatPrice(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

export function MenuBrowser({ categories, items, cart, onAddToCart, onRemoveFromCart }: MenuBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [dietFilter, setDietFilter] = useState<DietFilter>("all");
  const [curatedFilter, setCuratedFilter] = useState<CuratedFilter>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const closeCategory = () => {
    setSelectedCategory(null);
    setSearchQuery("");
    setDietFilter("all");
    setCuratedFilter(null);
  };

  const selectCategory = (categoryId: number) => {
    setSelectedCategory(categoryId);
    setSearchQuery("");
    setDietFilter("all");
    setCuratedFilter(null);
  };

  usePanelHistory(selectedCategory !== null, closeCategory);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.displayOrder - b.displayOrder),
    [categories]
  );

  const filteredItems = useMemo(() => {
    let result = items.filter((i) => i.categoryId === selectedCategory);
    result = result.sort((a, b) => a.displayOrder - b.displayOrder);

    if (dietFilter !== "all") {
      result = result.filter((item) => {
        const tags = parseTags(item.tags).map((t) => t.toLowerCase());
        if (dietFilter === "veg") return tags.includes("veg");
        return tags.includes("non-veg") || tags.includes("nonveg");
      });
    }

    if (curatedFilter) {
      result = result.filter((item) => {
        const tags = parseTags(item.tags).map((t) => t.toLowerCase());
        return tags.includes(curatedFilter);
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.nameKannada && item.nameKannada.includes(q))
      );
    }

    return result;
  }, [items, selectedCategory, dietFilter, curatedFilter, searchQuery]);

  const hasChefSpecial = useMemo(
    () => items.some((i) => i.categoryId === selectedCategory && parseTags(i.tags).map((t) => t.toLowerCase()).includes("chef-special")),
    [items, selectedCategory]
  );
  const hasGokoSpecial = useMemo(
    () => items.some((i) => i.categoryId === selectedCategory && parseTags(i.tags).map((t) => t.toLowerCase()).includes("goko-special")),
    [items, selectedCategory]
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
      quantity: 1,
      imageUrl: item.imageUrl || "",
    });
  };

  if (selectedCategory === null) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="px-4 pb-24"
      >
        <h2 className="mb-4 text-xl font-bold text-gray-800 dark:text-foreground">Menu</h2>
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {sortedCategories.map((cat) => (
            <motion.button
              key={cat.id}
              variants={{ hidden: { opacity: 0, y: 16, scale: 0.95 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.33, 1, 0.68, 1] } } }}
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.03, y: -2 }}
              onClick={() => selectCategory(cat.id)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card p-5 shadow-sm dark:shadow-none transition-shadow hover:border-brand-green/30 hover:shadow-lg dark:hover:shadow-none"
            >
              <span className="text-3xl">{cat.icon}</span>
              <span className="text-sm font-semibold text-gray-800 dark:text-foreground">{cat.name}</span>
              {cat.nameKannada && (
                <span className="text-xs text-gray-500">{cat.nameKannada}</span>
              )}
              {cat.description && (
                <span className="line-clamp-2 text-center text-xs text-gray-400">
                  {cat.description}
                </span>
              )}
            </motion.button>
          ))}
        </motion.div>
      </motion.div>
    );
  }

  const currentCategory = categories.find((c) => c.id === selectedCategory);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="grid h-[calc(100dvh-7.5rem)] min-h-[26rem] grid-cols-[4.25rem_minmax(0,1fr)] gap-1.5 overflow-hidden px-2 pb-2 sm:h-[calc(100dvh-8.5rem)] sm:min-h-[30rem] sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3 sm:px-3"
    >
      <nav aria-label="Food categories" className="min-h-0 overflow-y-auto overscroll-contain pr-1">
        <button
          type="button"
          onClick={closeCategory}
          className="mb-2 flex w-full items-center justify-center gap-0.5 rounded-lg bg-gray-100 px-1 py-1.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-200 dark:bg-muted dark:text-foreground dark:hover:bg-accent sm:text-xs"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Menu
        </button>
        <div className="space-y-0.5">
          {sortedCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              aria-current={cat.id === selectedCategory ? "page" : undefined}
              onClick={() => selectCategory(cat.id)}
              className={cat.id === selectedCategory
                ? "flex w-full flex-col items-center gap-0.5 rounded-lg bg-brand-green px-0.5 py-1.5 text-center text-white shadow-sm sm:px-1.5"
                : "flex w-full flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-center text-gray-500 transition-colors hover:bg-brand-green/10 hover:text-brand-green dark:text-gray-400 dark:hover:bg-brand-green/20 sm:px-1.5"}
            >
              <span className="text-lg leading-none sm:text-xl">{cat.icon}</span>
              <span className="line-clamp-2 text-[9px] font-semibold leading-tight sm:text-[11px]">{cat.name}</span>
              {cat.nameKannada && (
                <span className="line-clamp-1 text-[8px] leading-tight opacity-80 sm:text-[9px]">{cat.nameKannada}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-1">
          <h2 className="truncate text-sm font-bold text-gray-800 dark:text-foreground sm:text-base">
            {currentCategory?.icon} {currentCategory?.name}
          </h2>
          {currentCategory?.nameKannada && (
            <p className="truncate text-[11px] text-gray-500">{currentCategory.nameKannada}</p>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-1.5 shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search dishes…"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 pr-8 text-xs outline-none transition-all duration-200 focus:border-brand-green focus:bg-white focus-visible:goko-focus focus:shadow-sm dark:border-border dark:bg-muted dark:text-foreground dark:focus:bg-accent dark:focus:shadow-none sm:text-sm"
        />
        <AnimatePresence>
          {searchQuery && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-white transition-colors hover:bg-gray-400"
            >
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Diet filter */}
      <div className="mb-1 flex shrink-0 flex-nowrap gap-1 overflow-x-auto pb-0.5 sm:mb-2 sm:gap-2">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setDietFilter("all")}
          className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 sm:px-4 sm:py-2 sm:text-xs ${
            dietFilter === "all"
              ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 shadow-sm dark:shadow-none"
              : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2a2a2a]"
          }`}
        >
          All
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setDietFilter("veg")}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 sm:gap-1.5 sm:px-4 sm:py-2 sm:text-xs ${
            dietFilter === "veg"
              ? "bg-green-600 text-white shadow-sm dark:shadow-none"
              : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 hover:bg-green-50 dark:hover:bg-green-950"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Veg
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setDietFilter("nonveg")}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 sm:gap-1.5 sm:px-4 sm:py-2 sm:text-xs ${
            dietFilter === "nonveg"
              ? "bg-red-600 text-white shadow-sm dark:shadow-none"
              : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-950"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-red-500" />
          Non-veg
        </motion.button>
      </div>

      {/* Curated filter chips */}
      {(hasChefSpecial || hasGokoSpecial) && (
      <div className="mb-2 flex shrink-0 flex-nowrap gap-1.5 overflow-x-auto pb-0.5 sm:mb-4 sm:gap-2">
          {hasChefSpecial && (
            <button
              onClick={() => setCuratedFilter(curatedFilter === "chef-special" ? null : "chef-special")}
              className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium transition sm:gap-1.5 sm:px-4 sm:py-2 sm:text-xs ${
                curatedFilter === "chef-special"
                  ? "bg-purple-600 text-white"
                  : "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50"
              }`}
            >
              👨‍🍳 Chef Special
            </button>
          )}
          {hasGokoSpecial && (
            <button
              onClick={() => setCuratedFilter(curatedFilter === "goko-special" ? null : "goko-special")}
              className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium transition sm:gap-1.5 sm:px-4 sm:py-2 sm:text-xs ${
                curatedFilter === "goko-special"
                  ? "bg-indigo-600 text-white"
                  : "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
              }`}
            >
              ⭐ Goko Special
            </button>
          )}
        </div>
      )}

      {/* Items grid */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <AnimatePresence mode="popLayout">
          {filteredItems.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-8 text-center text-sm text-gray-500"
            >
              No items found
            </motion.p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {filteredItems.map((item) => {
              const tags = parseTags(item.tags);
              const isUnavailable = item.isAvailable !== 1 || item.price <= 0;
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
                  className={`flex flex-col rounded-2xl border bg-white dark:bg-card p-2 shadow-sm dark:shadow-none transition-all duration-200 sm:p-3 ${
                    isUnavailable
                      ? "border-gray-100 dark:border-border opacity-50"
                      : "border-gray-100 dark:border-border hover:border-brand-green/30 hover:shadow-lg dark:hover:shadow-none"
                  }`}
                >
                  {/* Image */}
                  <div className="h-16 w-full shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-[#1c1c1c] sm:h-24 sm:rounded-xl">
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
                      {currentCategory?.icon || "🍽️"}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between pt-1.5 sm:pt-2">
                    <div>
                      <h3 className="text-[13px] font-semibold leading-tight text-gray-800 dark:text-foreground sm:text-sm">
                        {item.name}
                      </h3>
                      {item.nameKannada && (
                        <p className="line-clamp-1 text-[11px] text-gray-500 sm:text-xs">{item.nameKannada}</p>
                      )}
                      {/* Tags */}
                      {tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
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
                                className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:px-2 sm:text-xs ${classes}`}
                              >
                                {display}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 sm:mt-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-800 dark:text-foreground sm:text-sm">
                          {isUnavailable ? (
                            <span className="text-gray-400">Unavailable</span>
                          ) : (
                            formatPrice(item.price)
                          )}
                        </span>
                        {showLowStock && (
                          <span className="rounded-full bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-400">
                            {item.stockQuantity} left
                          </span>
                        )}
                      </div>

                      {!isUnavailable && (
                        <>
                          <AnimatePresence mode="wait">
                          {qty === 0 ? (
                            <motion.button
                              key="add"
                              initial={{ scale: 0.9, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.9, opacity: 0 }}
                              whileTap={{ scale: 0.92 }}
                              onClick={() => handleAdd(item)}
                              className="goko-gradient-cta rounded-lg px-2 py-2 text-[11px] font-semibold text-white shadow-sm transition-shadow hover:shadow-md dark:shadow-none sm:px-3.5 sm:py-2.5 sm:text-sm"
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
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
            </div>
          )}
        </AnimatePresence>
      </div>
      </div>
    </motion.div>
  );
}
