/** The label of a link between two commands: the file name of the first artifact it carries (a folder keeps its "/"), and how many more. */
export function linkLabel(via: readonly string[]): string {
  const first = via[0];
  if (first === undefined) return "";
  const folder = first.endsWith("/");
  const name = first.split("/").filter((part) => part !== "").at(-1) ?? first;
  return `${name}${folder ? "/" : ""}${via.length > 1 ? ` +${via.length - 1}` : ""}`;
}
