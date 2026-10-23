import { CodingAgentClientError, cancelledError } from "./errors.js";

interface SseFrame { event: string; id?: string; data: string; }
const MAX_FRAME_CHARACTERS = 1024 * 1024;

/** Decode only complete SSE frames; an interrupted frame must be replayed. */
export async function* readSseFrames(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let kind = "message";
  let id: string | undefined;
  let data: string[] = [];
  let frameLength = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw cancelledError();
      const chunk = await reader.read();
      if (signal.aborted) throw cancelledError();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      while (true) {
        const index = buffer.search(/[\r\n]/);
        if (index < 0 || (!chunk.done && index === buffer.length - 1 && buffer[index] === "\r")) break;
        const line = buffer.slice(0, index);
        const separatorLength = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(index + separatorLength);
        frameLength += line.length;
        if (frameLength > MAX_FRAME_CHARACTERS) throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Task event frame exceeds the supported size" });
        if (line === "") {
          if (data.length > 0) yield { event: kind, ...(id === undefined ? {} : { id }), data: data.join("\n") };
          kind = "message"; id = undefined; data = []; frameLength = 0;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") kind = value;
          else if (field === "data") data.push(value);
          else if (field === "id" && !value.includes("\0")) id = value;
        }
      }
      if (buffer.length + frameLength > MAX_FRAME_CHARACTERS) throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Task event frame exceeds the supported size" });
      if (chunk.done) return;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
