// Interface layer: the CLI download. Public on purpose: a member installs the CLI before they can sign in (ADR-0070).
// The packages are checked against the hashes in the manifest and in the installers, so a download proves itself.

import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "#common/auth/decorators.js";
import { ReleasesService, type ReleaseView } from "../application/releases.service.js";

@ApiTags("system · releases")
@Controller("v1/releases")
@Public()
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get("latest")
  @ApiOperation({ summary: "The latest CLI release: version, minimum Node.js, and a package per platform with its SHA-256 and URL" })
  @ApiOkResponse({ description: "The release; 404 when the installation was built without one." })
  latest(): Promise<ReleaseView> {
    return this.releases.latest();
  }

  @Get("latest/install.sh")
  @ApiOperation({ summary: "Installer for Linux and macOS: curl -fsSL <url> | sh" })
  async installSh(@Res() response: Response): Promise<void> {
    response.type("text/x-shellscript; charset=utf-8").setHeader("Cache-Control", "no-cache").send(await this.releases.installer("sh"));
  }

  @Get("latest/install.ps1")
  @ApiOperation({ summary: "Installer for Windows: irm <url> | iex" })
  async installPs1(@Res() response: Response): Promise<void> {
    response.type("text/plain; charset=utf-8").setHeader("Cache-Control", "no-cache").send(await this.releases.installer("ps1"));
  }

  @Get(":version/:file")
  @ApiOperation({ summary: "Download a CLI package (version, or latest)" })
  async download(@Param("version") version: string, @Param("file") file: string, @Res() response: Response): Promise<void> {
    const asset = await this.releases.asset(version, file);
    response.setHeader("Cache-Control", version === "latest" ? "no-cache" : "public, max-age=31536000, immutable");
    await new Promise<void>((resolve, reject) => {
      response.download(asset.path, asset.file, (error) => (error === undefined || error === null ? resolve() : reject(error)));
    });
  }
}
