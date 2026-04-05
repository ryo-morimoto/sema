// ~500 lines — medium application module
import fs from "fs";
import https from "https";

// ============================================================================
// Types
// ============================================================================

export type OrderId = string;
export type CustomerId = string;
export type ProductId = string;
export type Money = { amount: number; currency: string };

export interface Product {
  id: ProductId;
  name: string;
  price: Money;
  stock: number;
  category: string;
  tags: string[];
}

export interface CartItem {
  productId: ProductId;
  quantity: number;
  priceAtAdd: Money;
}

export interface Order {
  id: OrderId;
  customerId: CustomerId;
  items: CartItem[];
  total: Money;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  shippingAddress: Address;
  paymentMethod: PaymentMethod;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export enum OrderStatus {
  Pending = "pending",
  Confirmed = "confirmed",
  Processing = "processing",
  Shipped = "shipped",
  Delivered = "delivered",
  Cancelled = "cancelled",
  Refunded = "refunded",
}

export enum PaymentMethod {
  CreditCard = "credit_card",
  BankTransfer = "bank_transfer",
  PayPal = "paypal",
  Crypto = "crypto",
}

export interface Discount {
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minOrderAmount?: Money;
  maxUses: number;
  currentUses: number;
  expiresAt: Date;
}

export interface ShippingRate {
  carrier: string;
  method: string;
  cost: Money;
  estimatedDays: number;
}

export interface OrderEvent {
  orderId: OrderId;
  type: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface InventoryAlert {
  productId: ProductId;
  currentStock: number;
  threshold: number;
  severity: "low" | "critical" | "out_of_stock";
}

// ============================================================================
// Pure Functions — Business Logic
// ============================================================================

export function calculateSubtotal(items: CartItem[]): Money {
  const total = items.reduce((sum, item) => sum + item.priceAtAdd.amount * item.quantity, 0);
  return { amount: total, currency: items[0]?.currency ?? "USD" };
}

export function applyDiscount(subtotal: Money, discount: Discount): Money {
  if (discount.type === "percentage") {
    return { amount: subtotal.amount * (1 - discount.value / 100), currency: subtotal.currency };
  }
  return { amount: Math.max(0, subtotal.amount - discount.value), currency: subtotal.currency };
}

export function calculateTax(subtotal: Money, taxRate: number): Money {
  return { amount: subtotal.amount * taxRate, currency: subtotal.currency };
}

export function calculateShipping(items: CartItem[], rate: ShippingRate): Money {
  return rate.cost;
}

export function calculateTotal(
  items: CartItem[],
  discount: Discount | null,
  taxRate: number,
  shippingRate: ShippingRate,
): Money {
  let subtotal = calculateSubtotal(items);
  if (discount && isDiscountValid(discount)) {
    subtotal = applyDiscount(subtotal, discount);
  }
  const tax = calculateTax(subtotal, taxRate);
  const shipping = calculateShipping(items, shippingRate);
  return {
    amount: subtotal.amount + tax.amount + shipping.amount,
    currency: subtotal.currency,
  };
}

export function isDiscountValid(discount: Discount): boolean {
  return discount.currentUses < discount.maxUses && discount.expiresAt > new Date();
}

export function validateOrder(order: Order): string[] {
  const errors: string[] = [];
  if (order.items.length === 0) errors.push("Order must have at least one item");
  if (order.total.amount <= 0) errors.push("Order total must be positive");
  if (!order.shippingAddress.zip) errors.push("Shipping address must have zip code");
  if (!order.shippingAddress.country) errors.push("Shipping address must have country");
  for (const item of order.items) {
    if (item.quantity <= 0) errors.push(`Invalid quantity for product ${item.productId}`);
  }
  return errors;
}

export function formatMoney(money: Money): string {
  return `${money.currency} ${money.amount.toFixed(2)}`;
}

export function formatOrderSummary(order: Order): string {
  const items = order.items
    .map((i) => `  ${i.productId} x${i.quantity} @ ${formatMoney(i.priceAtAdd)}`)
    .join("\n");
  return `Order ${order.id} (${order.status})\n${items}\nTotal: ${formatMoney(order.total)}`;
}

export function groupItemsByCategory(items: CartItem[], products: Map<ProductId, Product>): Map<string, CartItem[]> {
  const groups = new Map<string, CartItem[]>();
  for (const item of items) {
    const product = products.get(item.productId);
    const category = product?.category ?? "unknown";
    const group = groups.get(category) ?? [];
    group.push(item);
    groups.set(category, group);
  }
  return groups;
}

export function sortOrdersByDate(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function filterOrdersByStatus(orders: Order[], status: OrderStatus): Order[] {
  return orders.filter((o) => o.status === status);
}

export function checkInventory(products: Product[], threshold: number): InventoryAlert[] {
  return products
    .filter((p) => p.stock <= threshold)
    .map((p) => ({
      productId: p.id,
      currentStock: p.stock,
      threshold,
      severity: p.stock === 0 ? "out_of_stock" as const : p.stock <= threshold / 2 ? "critical" as const : "low" as const,
    }));
}

export const buildSearchIndex = (products: Product[]): Map<string, ProductId[]> => {
  const index = new Map<string, ProductId[]>();
  for (const product of products) {
    const terms = [...product.name.toLowerCase().split(/\s+/), ...product.tags.map((t) => t.toLowerCase())];
    for (const term of terms) {
      const existing = index.get(term) ?? [];
      existing.push(product.id);
      index.set(term, existing);
    }
  }
  return index;
};

export function searchProducts(query: string, index: Map<string, ProductId[]>): ProductId[] {
  const terms = query.toLowerCase().split(/\s+/);
  const results = new Map<ProductId, number>();
  for (const term of terms) {
    for (const id of index.get(term) ?? []) {
      results.set(id, (results.get(id) ?? 0) + 1);
    }
  }
  return [...results.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// ============================================================================
// Effectful Functions — I/O and Side Effects
// ============================================================================

export async function loadProductCatalog(path: string): Promise<Product[]> {
  const raw = fs.readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

export async function saveOrder(path: string, order: Order): Promise<void> {
  fs.writeFileSync(path, JSON.stringify(order, null, 2));
}

export async function fetchExchangeRate(from: string, to: string): Promise<number> {
  return new Promise((resolve, reject) => {
    https.get(`https://api.exchange.com/rate?from=${from}&to=${to}`, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data).rate));
      res.on("error", reject);
    });
  });
}

export async function sendOrderConfirmation(order: Order): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      orderId: order.id,
      customerId: order.customerId,
      total: formatMoney(order.total),
    });
    const req = https.request(
      { hostname: "api.notifications.com", path: "/send", method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`Notification failed: ${res.statusCode}`));
      },
    );
    req.write(payload);
    req.end();
  });
}

export function logOrderEvent(event: OrderEvent): void {
  console.log(`[${event.timestamp.toISOString()}] ${event.type}: Order ${event.orderId}`);
}

export async function backupOrders(dir: string, orders: Order[]): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${dir}/backup-${timestamp}.json`;
  fs.writeFileSync(path, JSON.stringify(orders, null, 2));
}

export async function fetchProductUpdates(since: Date): Promise<Product[]> {
  return new Promise((resolve, reject) => {
    https.get(`https://api.products.com/updates?since=${since.toISOString()}`, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
      res.on("error", reject);
    });
  });
}

// ============================================================================
// Class — Mixed Concerns (Pure + Effectful)
// ============================================================================

export class OrderProcessor {
  private orders: Map<OrderId, Order> = new Map();
  private products: Map<ProductId, Product> = new Map();
  private discounts: Map<string, Discount> = new Map();
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  async initialize(): Promise<void> {
    const catalog = await loadProductCatalog(`${this.storagePath}/products.json`);
    for (const p of catalog) this.products.set(p.id, p);
  }

  calculateOrderTotal(items: CartItem[], discountCode?: string): Money {
    const discount = discountCode ? this.discounts.get(discountCode) ?? null : null;
    return calculateTotal(items, discount, 0.08, { carrier: "default", method: "standard", cost: { amount: 5, currency: "USD" }, estimatedDays: 5 });
  }

  async createOrder(customerId: CustomerId, items: CartItem[], address: Address, payment: PaymentMethod): Promise<Order> {
    const total = this.calculateOrderTotal(items);
    const order: Order = {
      id: `ORD-${Date.now()}`,
      customerId,
      items,
      total,
      status: OrderStatus.Pending,
      createdAt: new Date(),
      updatedAt: new Date(),
      shippingAddress: address,
      paymentMethod: payment,
    };
    const errors = validateOrder(order);
    if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(", ")}`);
    this.orders.set(order.id, order);
    await saveOrder(`${this.storagePath}/orders/${order.id}.json`, order);
    logOrderEvent({ orderId: order.id, type: "created", timestamp: new Date(), metadata: { customerId } });
    await sendOrderConfirmation(order);
    return order;
  }

  async cancelOrder(orderId: OrderId): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);
    if (order.status === OrderStatus.Shipped || order.status === OrderStatus.Delivered) {
      throw new Error(`Cannot cancel order in status: ${order.status}`);
    }
    const updated = { ...order, status: OrderStatus.Cancelled, updatedAt: new Date() };
    this.orders.set(orderId, updated);
    await saveOrder(`${this.storagePath}/orders/${orderId}.json`, updated);
    logOrderEvent({ orderId, type: "cancelled", timestamp: new Date(), metadata: {} });
  }

  getOrdersByCustomer(customerId: CustomerId): Order[] {
    return [...this.orders.values()].filter((o) => o.customerId === customerId);
  }

  getOrderSummary(orderId: OrderId): string {
    const order = this.orders.get(orderId);
    if (!order) return "Order not found";
    return formatOrderSummary(order);
  }

  checkInventoryAlerts(threshold: number): InventoryAlert[] {
    return checkInventory([...this.products.values()], threshold);
  }

  async syncProducts(): Promise<number> {
    const lastSync = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const updates = await fetchProductUpdates(lastSync);
    for (const p of updates) this.products.set(p.id, p);
    return updates.length;
  }

  async backup(): Promise<void> {
    await backupOrders(`${this.storagePath}/backups`, [...this.orders.values()]);
  }
}
