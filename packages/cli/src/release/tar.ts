// A small ustar writer and reader for the release archives. Tar and gzip are on every platform the installers
// target (Windows 10 and later ship tar.exe), so one .tar.gz serves them all. Only regular files are written or
// read; the output is reproducible (fixed mtime, owner and gzip header).

import { gunzipSync, gzipSync } from "node:zlib";

export interface TarEntry {
  /** POSIX path inside the archive, without a leading slash. */
  path: string;
  data: Buffer;
  /** File mode; 0o644 when omitted. */
  mode?: number;
}

const BLOCK = 512;

function field(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Tar field too long: ${value}`);
  bytes.copy(header, offset);
}

function octal(header: Buffer, offset: number, length: number, value: number): void {
  field(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

/** Splits a path into the ustar `prefix` and `name` so that each fits its field. */
function splitPath(path: string): { prefix: string; name: string } {
  if (Buffer.byteLength(path) <= 100) return { prefix: "", name: path };
  for (let index = path.indexOf("/"); index !== -1; index = path.indexOf("/", index + 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { prefix, name };
  }
  throw new Error(`Path is too long for a tar archive: ${path}`);
}

function assertSafe(path: string): void {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

export function createTarGz(entries: readonly TarEntry[], mtime = 0): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    assertSafe(entry.path);
    const { prefix, name } = splitPath(entry.path);
    const header = Buffer.alloc(BLOCK);
    field(header, 0, 100, name);
    octal(header, 100, 8, entry.mode ?? 0o644);
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, entry.data.length);
    octal(header, 136, 12, mtime);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    field(header, 257, 6, "ustar\0");
    field(header, 263, 2, "00");
    field(header, 345, 155, prefix);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    field(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, entry.data, Buffer.alloc((BLOCK - (entry.data.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

function text(header: Buffer, offset: number, length: number): string {
  const end = header.indexOf(0, offset);
  return header.toString("utf8", offset, end === -1 || end > offset + length ? offset + length : end);
}

/** The regular files of a .tar.gz, in archive order. Directories and other entry types are skipped. */
export function readTarGz(archive: Buffer): TarEntry[] {
  const tar = gunzipSync(archive);
  const entries: TarEntry[] = [];
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0x30);
    const prefix = text(header, 345, 155);
    const path = `${prefix === "" ? "" : `${prefix}/`}${text(header, 0, 100)}`;
    const start = offset + BLOCK;
    if (type === "0" || type === "\0") {
      assertSafe(path);
      entries.push({ path, data: Buffer.from(tar.subarray(start, start + size)), mode: parseInt(text(header, 100, 8).trim() || "0", 8) });
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}
