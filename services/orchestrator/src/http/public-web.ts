// Public-web HTTP boundary: validate each hop and connect only to the validated DNS address.
// No proxy environment variables, cookies, credentials, browser scripts or caller headers.
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import ipaddr from "ipaddr.js";
import { WebRequestError } from "@kintsugi/runtime-sdk";

const blocked = (): WebRequestError => new WebRequestError("Only public HTTP/HTTPS URLs on standard ports are allowed. Private networks, credentials and signed URLs are blocked.");
export function publicWebUrl(value: string): URL {
  if (value.length > 4096 || /[\p{Cc}\p{Cf}\\]/u.test(value) || /%(?:00|0a|0d)/i.test(value)) throw blocked();
  let url: URL;
  try { url = new URL(value); } catch { throw blocked(); }
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.port !== "") throw blocked();
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "" || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host) || (!host.includes(".") && isIP(host) === 0)) throw blocked();
  for (const key of url.searchParams.keys()) {
    if (/(?:^|[-_])(?:token|key|sig|signature|secret|password|credential|authorization|auth)(?:$|[-_])/i.test(key) || /^x-(?:amz|goog)-/i.test(key)) throw blocked();
  }
  if (isIP(host) !== 0 && !publicAddress(host)) throw blocked();
  url.hash = "";
  return url;
}

function publicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  // Mapped/transition IPv6 may reach IPv4 networks; reject it rather than reinterpret it.
  if (parsed.range() !== "unicast") return false;
  if (parsed.kind() === "ipv6") {
    const bytes = parsed.toByteArray();
    if ((bytes[0]! & 0xe0) !== 0x20) return false; // Currently allocated global unicast only.
    // Documentation space 3fff::/20 (not present in older ipaddr tables).
    if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2]! & 0xf0) === 0) return false;
  }
  return true;
}

async function pinnedAddress(url: URL, signal: AbortSignal): Promise<{ address: string; family: number }> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    if (!publicAddress(hostname)) throw blocked();
    return { address: hostname, family: isIP(hostname) };
  }
  // DNS lookup is bounded by the caller's deadline, including while the OS resolver is slow.
  const records = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const abort = (): void => reject(new WebRequestError("Public website DNS lookup timed out or was cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    void lookup(hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  if (records.length === 0 || records.some((record) => !publicAddress(record.address))) throw blocked();
  return records.find((record) => record.family === 4) ?? records[0]!;
}

async function requestOnce(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const pinned = await pinnedAddress(url, signal);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", agent: false, signal, family: pinned.family,
      // Preserve the original Host, TLS SNI and certificate verification. DNS cannot change at connect time.
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      headers: { Accept: "text/html, application/xhtml+xml, text/plain, text/markdown, application/json;q=0.8", "Accept-Encoding": "gzip, br, deflate", "User-Agent": "Kintsugi-Web/1.0" },
      maxHeaderSize: 16_384,
    }, (response) => { response.on("error", () => undefined); resolve(response); });
    request.on("error", reject);
    request.end();
  });
}

export interface PublicWebResponse { finalUrl: string; contentType: string; text: string }
export async function readPublicWeb(url: URL, options: { signal: AbortSignal; maxBytes: number; maxRedirects: number }): Promise<PublicWebResponse> {
  let current = publicWebUrl(url.href);
  const seen = new Set<string>();
  for (let hop = 0; ; hop += 1) {
    options.signal.throwIfAborted();
    if (seen.has(current.href)) throw new WebRequestError("Website redirected in a loop.");
    seen.add(current.href);
    const response = await requestOnce(current, options.signal);
    // Handle errors even for redirect and rejected-content responses we destroy without reading.
    response.on("error", () => undefined);
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.destroy();
      if (hop >= options.maxRedirects || response.headers.location === undefined) throw new WebRequestError("Website exceeded the redirect limit or returned an invalid redirect.");
      const next = publicWebUrl(new URL(response.headers.location, current).href);
      if (current.protocol === "https:" && next.protocol !== "https:") throw new WebRequestError("HTTPS to HTTP redirects are blocked.");
      current = next;
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new WebRequestError(status === 429 ? "Website rate limited the request. Wait before trying again; do not repeatedly retry." : `Website returned HTTP ${status}. Try a different public source.`);
    }
    const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
    if (!/^(?:text\/(?:html|plain|markdown)|application\/(?:xhtml\+xml|json))(?:;|$)/.test(contentType)) {
      response.destroy();
      throw new WebRequestError("Unsupported content type. Use a public HTML, plain-text, Markdown or JSON page; PDF, images and downloads are not supported.");
    }
    const encoding = response.headers["content-encoding"]?.toLowerCase() ?? "identity";
    const decoder = encoding === "gzip" ? createGunzip() : encoding === "br" ? createBrotliDecompress() : encoding === "deflate" ? createInflate() : undefined;
    if (decoder === undefined && encoding !== "identity") { response.destroy(); throw new WebRequestError("Unsupported website content encoding."); }
    const stream = decoder === undefined ? response : response.pipe(decoder);
    const abort = (): void => { response.destroy(); decoder?.destroy(new WebRequestError("Website request was cancelled or timed out.")); };
    const relay = (error: Error): void => { decoder?.destroy(error); };
    response.on("error", relay);
    options.signal.addEventListener("abort", abort, { once: true });
    let encodedBytes = 0;
    // Bound wire bytes as well as decompressed bytes, including pathological compression streams.
    const wire = (chunk: Buffer): void => {
      encodedBytes += chunk.length;
      if (encodedBytes > options.maxBytes) {
        const error = new WebRequestError("Website response exceeds the download size limit.");
        response.destroy(error); decoder?.destroy(error);
      }
    };
    response.on("data", wire);
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      options.signal.throwIfAborted();
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > options.maxBytes) throw new WebRequestError("Website response exceeds the decompressed size limit. Use a smaller page.");
        chunks.push(buffer);
      }
      options.signal.throwIfAborted();
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? "utf-8";
      let text: string;
      try { text = new TextDecoder(charset).decode(Buffer.concat(chunks)); }
      catch { throw new WebRequestError("Website uses an unsupported text encoding."); }
      return { finalUrl: current.href, contentType, text };
    } finally {
      options.signal.removeEventListener("abort", abort);
      response.off("error", relay); response.off("data", wire);
      response.destroy(); decoder?.destroy();
    }
  }
}
