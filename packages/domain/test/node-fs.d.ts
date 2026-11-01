declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
  export function readdirSync(path: URL): string[];
  export function statSync(path: URL): { isDirectory(): boolean };
}
