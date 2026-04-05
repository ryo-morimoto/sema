/**
 * elephant.ts を生成するスクリプト (~2000行)
 * big.ts の構造を 4 ドメインに拡張: orders, users, inventory, analytics
 */
import { writeFileSync } from "node:fs";

const domains = ["order", "user", "inventory", "analytics"];
const effects = [
  { mod: "fs", fn: "readFileSync", cap: "fs:read" },
  { mod: "fs", fn: "writeFileSync", cap: "fs:write" },
  { mod: "https", fn: "get", cap: "net:https" },
];

let out = `// ~2000 lines — elephant module (4 domains × pure/effectful/class)\nimport fs from "fs";\nimport https from "https";\n\n`;

for (const domain of domains) {
  const D = domain[0].toUpperCase() + domain.slice(1);

  // Types
  out += `// ${"=".repeat(76)}\n// Domain: ${D}\n// ${"=".repeat(76)}\n\n`;
  out += `export type ${D}Id = string;\n\n`;
  out += `export interface ${D}Record {\n  id: ${D}Id;\n  name: string;\n  status: ${D}Status;\n  createdAt: Date;\n  updatedAt: Date;\n  metadata: Record<string, unknown>;\n  tags: string[];\n  priority: number;\n  assignee: string | null;\n  description: string;\n}\n\n`;
  out += `export enum ${D}Status {\n  Active = "active",\n  Inactive = "inactive",\n  Pending = "pending",\n  Archived = "archived",\n  Deleted = "deleted",\n}\n\n`;
  out += `export interface ${D}Filter {\n  status?: ${D}Status;\n  assignee?: string;\n  minPriority?: number;\n  tags?: string[];\n  createdAfter?: Date;\n  createdBefore?: Date;\n}\n\n`;
  out += `export interface ${D}Stats {\n  total: number;\n  byStatus: Record<string, number>;\n  avgPriority: number;\n  topTags: Array<{ tag: string; count: number }>;\n}\n\n`;
  out += `export interface ${D}Event {\n  recordId: ${D}Id;\n  type: string;\n  timestamp: Date;\n  actor: string;\n  changes: Record<string, { from: unknown; to: unknown }>;\n}\n\n`;

  // Pure functions (8 per domain)
  out += `export function filter${D}s(records: ${D}Record[], filter: ${D}Filter): ${D}Record[] {\n`;
  out += `  return records.filter((r) => {\n    if (filter.status && r.status !== filter.status) return false;\n    if (filter.assignee && r.assignee !== filter.assignee) return false;\n    if (filter.minPriority !== undefined && r.priority < filter.minPriority) return false;\n    if (filter.tags && !filter.tags.some((t) => r.tags.includes(t))) return false;\n    if (filter.createdAfter && r.createdAt < filter.createdAfter) return false;\n    if (filter.createdBefore && r.createdAt > filter.createdBefore) return false;\n    return true;\n  });\n}\n\n`;

  out += `export function sort${D}s(records: ${D}Record[], key: keyof ${D}Record, desc = false): ${D}Record[] {\n`;
  out += `  return [...records].sort((a, b) => {\n    const va = a[key], vb = b[key];\n    const cmp = String(va).localeCompare(String(vb));\n    return desc ? -cmp : cmp;\n  });\n}\n\n`;

  out += `export function compute${D}Stats(records: ${D}Record[]): ${D}Stats {\n`;
  out += `  const byStatus: Record<string, number> = {};\n  const tagCount: Record<string, number> = {};\n  let totalPriority = 0;\n  for (const r of records) {\n    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;\n    totalPriority += r.priority;\n    for (const t of r.tags) tagCount[t] = (tagCount[t] ?? 0) + 1;\n  }\n  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));\n  return { total: records.length, byStatus, avgPriority: records.length ? totalPriority / records.length : 0, topTags };\n}\n\n`;

  out += `export function validate${D}(record: ${D}Record): string[] {\n`;
  out += `  const errors: string[] = [];\n  if (!record.name) errors.push("name is required");\n  if (record.priority < 0 || record.priority > 10) errors.push("priority must be 0-10");\n  if (!record.id) errors.push("id is required");\n  if (record.tags.length > 20) errors.push("too many tags (max 20)");\n  if (record.description.length > 5000) errors.push("description too long (max 5000)");\n  return errors;\n}\n\n`;

  out += `export const format${D}Summary = (record: ${D}Record): string => {\n`;
  out += `  const assignee = record.assignee ?? "unassigned";\n  return \`[\${record.status}] \${record.name} (P\${record.priority}) — \${assignee}\`;\n};\n\n`;

  out += `export function paginate${D}s(records: ${D}Record[], page: number, pageSize: number): { data: ${D}Record[]; total: number; pages: number } {\n`;
  out += `  const total = records.length;\n  const pages = Math.ceil(total / pageSize);\n  const data = records.slice((page - 1) * pageSize, page * pageSize);\n  return { data, total, pages };\n}\n\n`;

  out += `export function merge${D}Records(existing: ${D}Record[], incoming: ${D}Record[]): ${D}Record[] {\n`;
  out += `  const map = new Map(existing.map((r) => [r.id, r]));\n  for (const r of incoming) map.set(r.id, { ...map.get(r.id), ...r });\n  return [...map.values()];\n}\n\n`;

  out += `export function diff${D}Records(before: ${D}Record, after: ${D}Record): Record<string, { from: unknown; to: unknown }> {\n`;
  out += `  const changes: Record<string, { from: unknown; to: unknown }> = {};\n  for (const key of Object.keys(after) as (keyof ${D}Record)[]) {\n    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {\n      changes[key as string] = { from: before[key], to: after[key] };\n    }\n  }\n  return changes;\n}\n\n`;

  // Effectful functions (4 per domain)
  out += `export async function load${D}sFromDisk(path: string): Promise<${D}Record[]> {\n`;
  out += `  const raw = fs.readFileSync(path, "utf-8");\n  return JSON.parse(raw);\n}\n\n`;

  out += `export async function save${D}sToDisk(path: string, records: ${D}Record[]): Promise<void> {\n`;
  out += `  fs.writeFileSync(path, JSON.stringify(records, null, 2));\n}\n\n`;

  out += `export async function fetch${D}sFromAPI(endpoint: string): Promise<${D}Record[]> {\n`;
  out += `  return new Promise((resolve, reject) => {\n    https.get(endpoint, (res) => {\n      let data = "";\n      res.on("data", (chunk: string) => (data += chunk));\n      res.on("end", () => resolve(JSON.parse(data)));\n      res.on("error", reject);\n    });\n  });\n}\n\n`;

  out += `export function log${D}Event(event: ${D}Event): void {\n`;
  out += `  console.log(\`[\${event.timestamp.toISOString()}] \${event.type}: \${event.recordId} by \${event.actor}\`);\n}\n\n`;

  // Class
  out += `export class ${D}Service {\n`;
  out += `  private records: Map<${D}Id, ${D}Record> = new Map();\n`;
  out += `  private storagePath: string;\n\n`;
  out += `  constructor(storagePath: string) { this.storagePath = storagePath; }\n\n`;
  out += `  async load(): Promise<void> {\n    const data = await load${D}sFromDisk(\`\${this.storagePath}/${domain}s.json\`);\n    for (const r of data) this.records.set(r.id, r);\n  }\n\n`;
  out += `  async save(): Promise<void> {\n    await save${D}sToDisk(\`\${this.storagePath}/${domain}s.json\`, [...this.records.values()]);\n  }\n\n`;
  out += `  async sync(): Promise<number> {\n    const remote = await fetch${D}sFromAPI(\`https://api.example.com/${domain}s\`);\n    const merged = merge${D}Records([...this.records.values()], remote);\n    for (const r of merged) this.records.set(r.id, r);\n    return remote.length;\n  }\n\n`;
  out += `  add(record: ${D}Record): void {\n    const errors = validate${D}(record);\n    if (errors.length > 0) throw new Error(errors.join(", "));\n    this.records.set(record.id, record);\n    log${D}Event({ recordId: record.id, type: "created", timestamp: new Date(), actor: "system", changes: {} });\n  }\n\n`;
  out += `  update(id: ${D}Id, patch: Partial<${D}Record>): ${D}Record {\n    const existing = this.records.get(id);\n    if (!existing) throw new Error(\`${D} not found: \${id}\`);\n    const updated = { ...existing, ...patch, updatedAt: new Date() };\n    const changes = diff${D}Records(existing, updated);\n    this.records.set(id, updated);\n    log${D}Event({ recordId: id, type: "updated", timestamp: new Date(), actor: "system", changes });\n    return updated;\n  }\n\n`;
  out += `  getFiltered(filter: ${D}Filter): ${D}Record[] { return filter${D}s([...this.records.values()], filter); }\n\n`;
  out += `  getStats(): ${D}Stats { return compute${D}Stats([...this.records.values()]); }\n\n`;
  out += `  getSorted(key: keyof ${D}Record, desc = false): ${D}Record[] { return sort${D}s([...this.records.values()], key, desc); }\n\n`;
  out += `  format(id: ${D}Id): string {\n    const r = this.records.get(id);\n    return r ? format${D}Summary(r) : "Not found";\n  }\n\n`;
  out += `  async backup(): Promise<void> {\n    const ts = new Date().toISOString().replace(/[:.]/g, "-");\n    await save${D}sToDisk(\`\${this.storagePath}/backups/${domain}s-\${ts}.json\`, [...this.records.values()]);\n  }\n}\n\n`;
}

writeFileSync("bench/targets/elephant.ts", out);
const lines = out.split("\n").length;
console.log(`Generated elephant.ts: ${lines} lines, ${out.length} chars`);
