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

type DietFilter = "all" | "veg" | "nonveg";

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
  const [searchQuery, setSearchQuery] = useState("");

  const closeCategory = () => {
    setSelectedCategory(null);
    setSearchQuery("");
    setDietFilter("all");
  };

  const selectCategory = (categoryId: number) => {
    setSelectedCategory(categoryId);
    setSearchQuery("");
    setDietFilter("all");
  };

  usePanelHistory(selectedCategory !== null, closeCategory);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.displayOrder - b.displayOrder),
    [categories]
  );

  const categoryOrder = useMemo(() => {
    const map = new Map<number, number>();
    for (const cat of categories) map.set(cat.id, cat.displayOrder);
    return map;
  }, [categories]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const searching = q.length > 0;
    // Global search: match every category; empty search stays on the selected rail category.
    let result = searching
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            (item.nameKannada && item.nameKannada.includes(q))
        )
      : items.filter((i) => i.categoryId === selectedCategory);

    if (dietFilter !== "all") {
      result = result.filter((item) => {
        const tags = parseTags(item.tags).map((t) => t.toLowerCase());
        if (dietFilter === "veg") return tags.includes("veg");
        return tags.includes("non-veg") || tags.includes("nonveg");
      });
    }

    result = result.sort((a, b) => {
      if (searching) {
        const catDelta =
          (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0);
        if (catDelta !== 0) return catDelta;
      }
      return a.displayOrder - b.displayOrder;
    });

    return result;
  }, [items, selectedCategory, dietFilter, searchQuery, categoryOrder]);

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
    // From a global hit, land on that dish's category (keep diet; clear search).
    if (searchQuery.trim()) {
      setSelectedCategory(item.categoryId);
      setSearchQuery("");
    }
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
      className="grid h-[calc(100dvh-4.75rem)] min-h-[26rem] grid-cols-[4.25rem_minmax(0,1fr)] gap-1.5 overflow-hidden px-2 pb-0 sm:h-[calc(100dvh-5.5rem)] sm:min-h-[30rem] sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3 sm:px-3"
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
        {/* Search — global across categories while typing */}
        <div className="relative mb-1 shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search all dishes…"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 pr-9 text-[11px] outline-none transition-all duration-200 focus:border-brand-green focus:bg-white focus-visible:goko-focus focus:shadow-sm dark:border-border dark:bg-muted dark:text-foreground dark:focus:bg-accent dark:focus:shadow-none sm:px-3 sm:py-2 sm:pr-10 sm:text-xs"
        />
        {searchQuery ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 sm:pr-2">
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {/* Diet filter — All / Veg / Non-veg only, always one row */}
      <div
        role="group"
        aria-label="Diet filter"
        className="mb-1 grid shrink-0 grid-cols-3 gap-1 sm:mb-2 sm:gap-1.5"
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={() => setDietFilter("all")}
          className={`min-w-0 rounded-full px-1.5 py-1.5 text-center text-[11px] font-medium transition-all duration-200 sm:px-3 sm:py-2 sm:text-xs ${
            dietFilter === "all"
              ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 shadow-sm dark:shadow-none"
              : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#2a2a2a]"
          }`}
        >
          All
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={() => setDietFilter("veg")}
          className={`flex min-w-0 items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-[11px] font-medium transition-all duration-200 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs ${
            dietFilter === "veg"
              ? "bg-green-600 text-white shadow-sm dark:shadow-none"
              : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 hover:bg-green-50 dark:hover:bg-green-950"
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
          Veg
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={() => setDietFilter("nonveg")}
          className={`flex min-w-0 items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-[11px] font-medium transition-all duration-200 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs ${
            dietFilter === "nonveg"
              ? "bg-red-600 text-white shadow-sm dark:shadow-none"
              : "bg-gray-100 dark:bg-[#1c1c1c] text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-950"
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          Non-veg
        </motion.button>
      </div>

      {/* Items grid */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-[calc(3.75rem+env(safe-area-inset-bottom))]">
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
                  {/* Image */}
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
                      {currentCategory?.icon || "🍽️"}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between pt-1 sm:pt-1.5">
                    <div>
                      <h3 className="text-xs font-semibold leading-tight text-gray-800 dark:text-foreground sm:text-sm">
                        {item.name}
                      </h3>
                      {item.nameKannada && (
                        <p className="line-clamp-1 text-[10px] text-gray-500 sm:text-xs">{item.nameKannada}</p>
                      )}
                      {/* Tags */}
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
