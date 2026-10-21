import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { CliError } from "./profile.js";

export async function createFetchWithPrivateCa(path: string): Promise<typeof fetch> {
  let pem: string;
  try { pem = await readFile(path, "utf8"); } catch { throw new CliError("CA_FILE_UNAVAILABLE", "The configured private CA file could not be read"); }
  if (!pem.includes("-----BEGIN CERTIFICATE-----") || pem.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new CliError("CA_FILE_INVALID", "The configured CA file must contain certificate PEM data only");
  }
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.protocol !== "https:") throw new TypeError("Private CA transport requires HTTPS");
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const signal = init?.signal ?? undefined;
    return await new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(url, {
        method: init?.method ?? "GET",
        headers,
        ca: [...rootCertificates, pem],
        rejectUnauthorized: true,
        ...(signal === undefined ? {} : { signal }),
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers: response.headers as HeadersInit,
        })));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
  };
}
