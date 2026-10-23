import { describe, expect, it } from "vitest";
import { installCommands, platformName, type Release } from "./release-format";

const release: Release = {
  version: "0.1.0",
  builtAt: "2026-10-23T00:00:00.000Z",
  minNode: "22.19.0",
  baseUrl: "https://kintsugi.example",
  assets: [],
  installers: { sh: "https://kintsugi.example/api/v1/releases/latest/install.sh", ps1: "https://kintsugi.example/api/v1/releases/latest/install.ps1" },
};

describe("release helpers", () => {
  it("builds the one-line installers from the installation's own URLs", () => {
    expect(installCommands(release)).toEqual({
      sh: "curl -fsSL https://kintsugi.example/api/v1/releases/latest/install.sh | sh",
      ps1: 'powershell -ExecutionPolicy Bypass -Command "irm https://kintsugi.example/api/v1/releases/latest/install.ps1 | iex"',
    });
  });

  it("names the platforms and falls back to the id", () => {
    expect(platformName("darwin-arm64")).toBe("macOS (Apple silicon)");
    expect(platformName("freebsd-x64")).toBe("freebsd-x64");
  });
});
