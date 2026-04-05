// ~50 lines — small module
import fs from "fs";

export type Config = { port: number; host: string; debug: boolean };

export function loadConfig(path: string): Config {
  const raw = fs.readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  if (config.port < 0 || config.port > 65535) errors.push("invalid port");
  if (!config.host) errors.push("missing host");
  return errors;
}

export const formatConfig = (config: Config): string =>
  `${config.host}:${config.port}${config.debug ? " [debug]" : ""}`;
