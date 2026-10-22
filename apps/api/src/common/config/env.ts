// Typed access to the installation environment. Values come from the container
// environment (docs/reference/configuration.md); keep secrets out of this file.

export interface AppEnv {
  /** Port the API listens on inside `kintsugi-app`. */
  port: number;
  /** Nest log level. */
  logLevel: "error" | "warn" | "log" | "debug" | "verbose";
  /** Session cookies carry `Secure` when the installation is served over HTTPS (KINTSUGI_PUBLIC_URL). */
  secureCookies: boolean;
  /** Canonical public URL used in links and coding-agent install/auth requests. */
  publicUrl: string;
}

function canonicalPublicUrl(): string {
  const raw = process.env["KINTSUGI_PUBLIC_URL"] ?? "http://localhost:8080";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("KINTSUGI_PUBLIC_URL must be an absolute HTTP(S) URL"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("KINTSUGI_PUBLIC_URL must use HTTPS except for loopback, and cannot contain credentials, a query or a fragment");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function loadEnv(): AppEnv {
  const publicUrl = canonicalPublicUrl();
  return {
    port: Number(process.env["PORT"] ?? 3000),
    logLevel: (process.env["LOG_LEVEL"] ?? "log") as AppEnv["logLevel"],
    secureCookies: publicUrl.startsWith("https://"),
    publicUrl,
  };
}

export interface BootstrapAdmin {
  username: string;
  password: string;
}

const MIN_BOOTSTRAP_PASSWORD = 8;

/**
 * Credentials of the first admin, read only when the installation has no users yet.
 * There is no default password: an unset or short value fails startup instead of
 * creating a guessable (or empty, hence unusable) admin account.
 */
export function loadBootstrapAdmin(): BootstrapAdmin {
  const username = process.env["KINTSUGI_BOOTSTRAP_ADMIN_USER"] || "admin";
  const password = process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"] ?? "";
  if (password.length < MIN_BOOTSTRAP_PASSWORD) {
    throw new Error(
      `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD must be set (at least ${MIN_BOOTSTRAP_PASSWORD} characters) to create the first admin`,
    );
  }
  return { username, password };
}
