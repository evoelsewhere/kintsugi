import { describe, expect, it } from "vitest";
import { insertMention, mentionedNames, mentionQueryAt, mentionRanges, splitMentions } from "./wiki-mentions";

describe("where the mentions of a text are", () => {
  it("finds a name at the start, after white space and after punctuation, in lower case", () => {
    expect(mentionRanges("@Kim please check, (@lee.park) and \"@o-reilly\"").map((range) => range.username)).toEqual(["kim", "lee.park", "o-reilly"]);
    expect(mentionRanges("@kim").map((range) => [range.start, range.end])).toEqual([[0, 4]]);
  });

  it("leaves out an email address, a `@` in a word and a bare `@`", () => {
    expect(mentionRanges("write to kim@example.com or a@b and @ alone and @-x and @.y")).toEqual([]);
  });

  it("does not take the full stop or the dash that ends a sentence for part of the name", () => {
    expect(mentionedNames("Thanks @kim. And @lee-")).toEqual(["kim", "lee"]);
    expect(mentionedNames("@kim.lee is one name")).toEqual(["kim.lee"]);
  });

  it("finds none in inline code or in a code fence, and still finds the ones around them", () => {
    const text = "ask `@code-name` or @real\n```\n@in-a-fence\n```\nthen @after\n~~~\n@tilde\n~~~\n";
    expect(mentionedNames(text)).toEqual(["real", "after"]);
  });

  it("lists each name once, in the order of first appearance", () => {
    expect(mentionedNames("@b @a @b @A")).toEqual(["b", "a"]);
    expect(mentionedNames("")).toEqual([]);
  });
});

describe("what is being typed", () => {
  it("opens the suggestions on a `@` at the start or after a space, with what follows up to the cursor", () => {
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("hello @ki", 9)).toEqual({ start: 6, query: "ki" });
    expect(mentionQueryAt("ask (@le", 8)).toEqual({ start: 5, query: "le" });
  });

  it("does not open them inside a word, an email or after the name has ended", () => {
    expect(mentionQueryAt("kim@ex", 6)).toBeNull();
    expect(mentionQueryAt("@kim and", 8)).toBeNull();
    expect(mentionQueryAt("no at sign", 5)).toBeNull();
    expect(mentionQueryAt("@ki m", 5)).toBeNull();
  });

  it("looks only at what is before the cursor", () => {
    expect(mentionQueryAt("see @kim here", 7)).toEqual({ start: 4, query: "ki" });
  });
});

describe("choosing a suggestion", () => {
  it("replaces what was typed by @username and a space, and puts the cursor after it", () => {
    const query = mentionQueryAt("hello @ki", 9);
    expect(query).not.toBeNull();
    if (query === null) return;
    expect(insertMention("hello @ki", query, 9, "kim")).toEqual({ text: "hello @kim ", cursor: 11 });
  });

  it("keeps the text after the cursor and does not double a space that is there", () => {
    const text = "hello @ki and more";
    const query = mentionQueryAt(text, 9);
    if (query === null) throw new Error("no query");
    expect(insertMention(text, query, 9, "kim")).toEqual({ text: "hello @kim and more", cursor: 11 });
  });
});

describe("the chips of a text", () => {
  const directory = new Map([
    ["kim", "Kim Nguyen"],
    ["lee", "Lee Park"],
  ]);

  it("shows the mentions of people of the directory as chips, with their display name", () => {
    expect(splitMentions("Hi @kim, see with @lee.", directory)).toEqual([{ text: "Hi " }, { mention: "kim", displayName: "Kim Nguyen" }, { text: ", see with " }, { mention: "lee", displayName: "Lee Park" }, { text: "." }]);
  });

  it("leaves a name the directory does not know as plain text, so a mention tells nothing about who has access", () => {
    expect(splitMentions("Hi @stranger and @kim", directory)).toEqual([{ text: "Hi @stranger and " }, { mention: "kim", displayName: "Kim Nguyen" }]);
    expect(splitMentions("@nobody", directory)).toEqual([{ text: "@nobody" }]);
    expect(splitMentions("", directory)).toEqual([]);
  });
});
