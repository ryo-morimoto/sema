import fs from "fs";

export function readConfig(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

export async function fetchUser(id: string): Promise<{ name: string }> {
  return { name: "test" };
}
