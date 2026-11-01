// The routes of a Nest controller, read from its decorator metadata, so a test covers a route added later without
// anyone listing it by hand.

import "reflect-metadata";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

export interface ControllerRoute {
  handler: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The full path pattern, params as `:name`, without a leading slash. */
  path: string;
  /** Guards on the controller class and on the handler. */
  guards: unknown[];
}

const METHODS: Partial<Record<RequestMethod, ControllerRoute["method"]>> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.DELETE]: "DELETE",
};

const SOURCE = resolve(import.meta.dirname, "../../src");
const controllerFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? controllerFiles(path) : entry.name.endsWith(".controller.ts") ? [path] : [];
  });

/** Every controller of the API whose routes start with `projects/:id`, found by scanning the sources. */
export async function projectScopedControllers(): Promise<Array<abstract new (...args: never[]) => unknown>> {
  const found: Array<abstract new (...args: never[]) => unknown> = [];
  for (const file of controllerFiles(SOURCE)) {
    const exports = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const value of Object.values(exports)) {
      if (typeof value !== "function") continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, value) as unknown;
      if (typeof prefix === "string" && (prefix === "projects/:id" || prefix.startsWith("projects/:id/"))) found.push(value as abstract new (...args: never[]) => unknown);
    }
  }
  return found;
}

export function controllerRoutes(controller: abstract new (...args: never[]) => unknown): ControllerRoute[] {
  const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
  const routes: ControllerRoute[] = [];
  for (const handler of Object.getOwnPropertyNames(controller.prototype)) {
    const fn = (controller.prototype as Record<string, unknown>)[handler];
    if (handler === "constructor" || typeof fn !== "function") continue;
    const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
    const method = METHODS[Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod];
    if (path === undefined || method === undefined) continue;
    const handlerGuards = (Reflect.getMetadata(GUARDS_METADATA, fn) ?? []) as unknown[];
    routes.push({ handler, method, path: [prefix, path === "/" ? "" : path].filter((part) => part.length > 0).join("/"), guards: [...classGuards, ...handlerGuards] });
  }
  return routes;
}
