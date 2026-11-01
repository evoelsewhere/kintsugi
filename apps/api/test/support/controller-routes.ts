// The routes of a Nest controller, read from its decorator metadata, so a test covers a route added later without
// anyone listing it by hand.

import "reflect-metadata";
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
