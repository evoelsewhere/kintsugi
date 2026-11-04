// Shared kernel: base64 text from a request. The checks are linear in the text: a pattern with a repeated group over a
// few megabytes of text exhausts the regular expression engine's stack (a RangeError, a 500 for a valid upload).

const BASE64_TEXT = /^[A-Za-z0-9+/]*={0,2}$/;

/** Whether `text` is standard-alphabet base64 with its padding (a multiple of four characters, `=` only at the end). */
export function isBase64Text(text: string): boolean {
  return text.length % 4 === 0 && BASE64_TEXT.test(text);
}

/** The bytes `text` stands for, or undefined when it is not base64 (or not the canonical text of the bytes it decodes to). */
export function decodeBase64(text: string): Buffer | undefined {
  if (!isBase64Text(text)) return undefined;
  const bytes = Buffer.from(text, "base64");
  return bytes.toString("base64") === text ? bytes : undefined;
}
