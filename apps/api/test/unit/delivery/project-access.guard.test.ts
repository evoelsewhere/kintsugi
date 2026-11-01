// Project Access on the portal's document and Brain routes (ADR-0099 decision 4): the guard reads the project of `:id`
// and asks the one Project Access service; every route of both controllers sits behind it.

import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProjectAccessGuard, type ProjectAccessService } from "../../../src/modules/admin/project-access/index.js";
import { BrainController } from "../../../src/modules/delivery/brain/interface/brain.controller.js";
import { DocumentsController } from "../../../src/modules/delivery/documents/interface/documents.controller.js";
import { controllerRoutes } from "../../support/controller-routes.js";

function context(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function guard(requireRead: ProjectAccessService["requireRead"]): ProjectAccessGuard {
  return new ProjectAccessGuard({ requireRead } as ProjectAccessService);
}

describe("ProjectAccessGuard", () => {
  it("asks Project Access about the signed-in user and the project of :id", async () => {
    const requireRead = vi.fn().mockResolvedValue(undefined);
    await expect(guard(requireRead).canActivate(context({ sessionUser: { id: "u1", permissions: [] }, params: { id: "shop" } }))).resolves.toBe(true);
    expect(requireRead).toHaveBeenCalledWith("u1", "shop");
  });

  it("lets the 403 of Project Access through", async () => {
    const requireRead = vi.fn().mockRejectedValue(new ForbiddenException("Project Access is required"));
    await expect(guard(requireRead).canActivate(context({ sessionUser: { id: "u1", permissions: ["admin"] }, params: { id: "shop" } }))).rejects.toThrow("Project Access is required");
  });

  it("refuses a request without a session or without a project", async () => {
    const requireRead = vi.fn();
    await expect(guard(requireRead).canActivate(context({ params: { id: "shop" } }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard(requireRead).canActivate(context({ sessionUser: { id: "u1", permissions: [] }, params: {} }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(requireRead).not.toHaveBeenCalled();
  });
});

describe("portal project routes", () => {
  const routes = [...controllerRoutes(DocumentsController), ...controllerRoutes(BrainController)];

  it("enumerates the routes of both controllers", () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
    expect(routes.every((route) => route.path.startsWith("projects/:id"))).toBe(true);
  });

  it.each(routes.map((route) => [`${route.method} /${route.path}`, route] as const))("%s is behind the Project Access guard", (_name, route) => {
    expect(route.guards).toContain(ProjectAccessGuard);
  });
});
