// A small ZIP codec for agent package import and export (ADR-0026): stored and deflated
// entries, UTF-8 names, no encryption, no ZIP64. Reading is bounded (entry count, total
// size) and refuses unsafe paths, so an uploaded archive cannot escape or exhaust memory.

import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export interface UnzipLimits {
  /** Maximum number of file entries (default 200). */
  maxEntries?: number;
  /** Maximum total uncompressed size in bytes (default 5 MiB). */
  maxTotalBytes?: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
/** 1980-01-01 00:00: fixed, so the same package always zips to the same bytes. */
const DOS_DATE = 0x0021;

/** Zips text files (relative POSIX paths), deflated, in the map's order. */
export function zipFiles(files: ReadonlyMap<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of files) {
    const name = Buffer.from(path, "utf8");
    const data = Buffer.from(text, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A safe relative POSIX path, or undefined for paths that are absolute or climb out. */
function safePath(raw: string): string | undefined {
  const path = raw.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return undefined;
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return undefined;
  return parts.join("/");
}

/** Files macOS and Windows add to archives; never part of a package. */
const isNoise = (path: string): boolean => path.startsWith("__MACOSX/") || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(path);

/**
 * Unzips text files into a package-files map. Directory entries and OS noise files are
 * skipped; when every file sits under one top-level folder, that folder is removed (an
 * archive of `<name>/…`). Throws with a readable message on anything it cannot accept.
 */
export function unzipFiles(archive: Buffer, limits: UnzipLimits = {}): Map<string, string> {
  const maxEntries = limits.maxEntries ?? 200;
  let budget = limits.maxTotalBytes ?? 5 * 1024 * 1024;

  let end = -1;
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at--) {
    if (archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("not a ZIP archive");
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  if (count === 0xffff || cursor === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  if (count > maxEntries) throw new Error(`the archive holds more than ${maxEntries} entries`);

  const files = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_HEADER) throw new Error("corrupt ZIP central directory");
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const crc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;

    if (rawName.endsWith("/")) continue;
    const path = safePath(rawName);
    if (path === undefined) throw new Error(`unsafe path in archive: ${rawName}`);
    if (isNoise(path)) continue;
    if ((flags & 0x1) !== 0) throw new Error(`${path}: encrypted entries are not supported`);
    if (method !== 0 && method !== 8) throw new Error(`${path}: unsupported compression method ${method}`);
    if (size > budget) throw new Error("the archive is too large");

    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new Error(`${path}: corrupt local header`);
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    if (raw.length !== compressedSize) throw new Error(`${path}: truncated entry`);
    let data: Buffer;
    try {
      data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: budget });
    } catch {
      throw new Error(`${path}: cannot be decompressed (corrupt, or larger than allowed)`);
    }
    if (data.length !== size || crc32(data) !== crc) {
      throw new Error(`${path}: checksum mismatch`);
    }
    budget -= data.length;
    if (files.has(path)) throw new Error(`${path}: listed twice`);
    files.set(path, data.toString("utf8"));
  }
  return stripCommonFolder(files);
}

function stripCommonFolder(files: Map<string, string>): Map<string, string> {
  const paths = [...files.keys()];
  const first = paths[0]?.split("/")[0];
  if (first === undefined || !paths.every((path) => path.startsWith(`${first}/`))) return files;
  return new Map([...files].map(([path, text]) => [path.slice(first.length + 1), text]));
}
