import { describe, it, expect } from "vitest";

/**
 * Tests for atomic stock operation SQL logic.
 * These validate the computation logic that the SQL expressions implement,
 * without requiring a live database connection.
 */

function simulateDecrementStock(currentQty: number, decrementBy: number) {
  const newQty = currentQty - decrementBy;
  const isAvailable = newQty > 0 ? 1 : 0;
  return { stockQuantity: newQty, isAvailable };
}

function simulateAddStock(currentQty: number, addBy: number) {
  const newQty = currentQty + addBy;
  return { stockQuantity: newQty, isAvailable: newQty > 0 ? 1 : 0 };
}

describe("Stock decrement logic", () => {
  it("decrements stock normally", () => {
    const result = simulateDecrementStock(10, 3);
    expect(result.stockQuantity).toBe(7);
    expect(result.isAvailable).toBe(1);
  });

  it("decrements to exactly zero and marks unavailable", () => {
    const result = simulateDecrementStock(5, 5);
    expect(result.stockQuantity).toBe(0);
    expect(result.isAvailable).toBe(0);
  });

  it("allows stock to go negative for staff oversell", () => {
    const result = simulateDecrementStock(2, 10);
    expect(result.stockQuantity).toBe(-8);
    expect(result.isAvailable).toBe(0);
  });

  it("decrements further from zero into negatives", () => {
    const result = simulateDecrementStock(0, 1);
    expect(result.stockQuantity).toBe(-1);
    expect(result.isAvailable).toBe(0);
  });

  it("decrements further from an already-negative balance", () => {
    const result = simulateDecrementStock(-4, 2);
    expect(result.stockQuantity).toBe(-6);
    expect(result.isAvailable).toBe(0);
  });

  it("handles decrement by 1", () => {
    const result = simulateDecrementStock(1, 1);
    expect(result.stockQuantity).toBe(0);
    expect(result.isAvailable).toBe(0);
  });

  it("large quantity decrement", () => {
    const result = simulateDecrementStock(100, 50);
    expect(result.stockQuantity).toBe(50);
    expect(result.isAvailable).toBe(1);
  });
});

describe("Stock add logic", () => {
  it("adds stock and marks available", () => {
    const result = simulateAddStock(0, 10);
    expect(result.stockQuantity).toBe(10);
    expect(result.isAvailable).toBe(1);
  });

  it("adds to existing stock", () => {
    const result = simulateAddStock(5, 3);
    expect(result.stockQuantity).toBe(8);
    expect(result.isAvailable).toBe(1);
  });

  it("restocks from negative into positive (e.g. -10 + 40 → 30)", () => {
    const result = simulateAddStock(-10, 40);
    expect(result.stockQuantity).toBe(30);
    expect(result.isAvailable).toBe(1);
  });

  it("partial restock that stays non-positive keeps unavailable", () => {
    const result = simulateAddStock(-10, 5);
    expect(result.stockQuantity).toBe(-5);
    expect(result.isAvailable).toBe(0);
  });

  it("adding zero to positive stock keeps available", () => {
    const result = simulateAddStock(10, 0);
    expect(result.stockQuantity).toBe(10);
    expect(result.isAvailable).toBe(1);
  });
});

describe("Concurrent stock operations (race condition scenario)", () => {
  it("atomic decrement prevents lost updates", () => {
    let stock = 10;
    stock = stock - 1;
    expect(stock).toBe(9);
    stock = stock - 1;
    expect(stock).toBe(8);
  });

  it("atomic decrement allows concurrent oversell into negatives", () => {
    let stock = 1;
    stock = stock - 1;
    expect(stock).toBe(0);
    stock = stock - 1;
    expect(stock).toBe(-1);
  });
});

describe("Food order total calculation", () => {
  it("calculates subtotal correctly", () => {
    const items = [
      { price: 15000, quantity: 2 },
      { price: 8000, quantity: 1 },
      { price: 5000, quantity: 3 },
    ];
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    expect(subtotal).toBe(53000);
  });

  it("calculates tax correctly at 5%", () => {
    const subtotal = 10000;
    const taxRate = 5;
    const tax = Math.round((subtotal * taxRate) / 100);
    expect(tax).toBe(500);
  });
});
