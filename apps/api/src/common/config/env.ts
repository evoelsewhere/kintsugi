// Typed access to the installation environment. Values come from the container
// environment (docs/reference/configuration.md); keep secrets out of this file.

export interface AppEnv {
  /** Port the API listens on inside `kintsugi-app`. */
  port: number;
  /** Nest log level. */
  logLevel: "error" | "warn" | "log" | "debug" | "verbose";
}

export function loadEnv(): AppEnv {
  return {
    port: Number(process.env["PORT"] ?? 3000),
    logLevel: (process.env["LOG_LEVEL"] ?? "log") as AppEnv["logLevel"],
  };
}
