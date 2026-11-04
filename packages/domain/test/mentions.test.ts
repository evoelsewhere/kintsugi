// Mentions in a comment (P3-004): which names a text names, and the people they are (COL-08, COL-10).

import { describe, expect, it } from "vitest";
import { MENTIONS_MAX, mentionsOf, resolveMentions } from "../src/mentions.js";

describe("mentionsOf", () => {
  it("reads @name at the start of the text and of a line, and after white space or punctuation", () => {
    expect(mentionsOf("@ada please look")).toEqual(["ada"]);
    expect(mentionsOf("first\n@grace and (@linus), then:@ken; \"@dennis\" [@brian] <@bjarne>")).toEqual(["grace", "linus", "ken", "dennis", "brian", "bjarne"]);
  });

  it("takes the characters of a username and leaves the punctuation that ends a sentence", () => {
    expect(mentionsOf("Thanks @ada.lovelace, @grace_h and @dennis-r. Ask @ken.")).toEqual(["ada.lovelace", "grace_h", "dennis-r", "ken"]);
    expect(mentionsOf("@ada, @ada! @ADA again")).toEqual(["ada"]);
    expect(mentionsOf("@a1 @7up @x")).toEqual(["a1", "7up", "x"]);
  });

  it("does not read an address, a handle in a word or a bare @", () => {
    expect(mentionsOf("mail ada@example.com or x@y.z")).toEqual([]);
    expect(mentionsOf("word@name and under_score@name and 5@6")).toEqual([]);
    expect(mentionsOf("@ and @@ada and @-x and @.y and a @ b")).toEqual([]);
    expect(mentionsOf("")).toEqual([]);
  });

  it("does not read code: inline, in a fence or in a tilde fence", () => {
    expect(mentionsOf("run `npm i @scope/pkg` for @ada and ``@x`` too")).toEqual(["ada"]);
    expect(mentionsOf("before @ada\n```ts\nconst a = '@hidden';\n```\nafter @grace\n~~~\n@also\n~~~\n@ken")).toEqual(["ada", "grace", "ken"]);
    // An unclosed fence hides the rest, as a Markdown reader shows it as code.
    expect(mentionsOf("@ada\n```\n@hidden")).toEqual(["ada"]);
  });

  it("names a person once, in order, and reads at most 50", () => {
    expect(mentionsOf("@b @a @b @c @a")).toEqual(["b", "a", "c"]);
    const many = Array.from({ length: 80 }, (_, n) => `@user${n}`).join(" ");
    expect(mentionsOf(many)).toHaveLength(MENTIONS_MAX);
  });

  it("reads CRLF like LF", () => {
    expect(mentionsOf("@ada\r\n```\r\n@no\r\n```\r\n@grace\r\n")).toEqual(["ada", "grace"]);
  });
});

describe("resolveMentions", () => {
  const directory = [
    { id: "u1", username: "ada" },
    { id: "u2", username: "Grace" },
  ];

  it("gives the ids of the people the names are, once each and in the order of the names", () => {
    expect(resolveMentions(["grace", "ada", "grace"], directory)).toEqual(["u2", "u1"]);
    expect(resolveMentions([], directory)).toEqual([]);
  });

  it("leaves out a name that is not in the directory, and a name nobody has is the same as one without access", () => {
    // The directory holds only people with Project Access: `linus` exists as a user but is not in it.
    const unknown = resolveMentions(["ada", "nobody-has-this"], directory);
    const withoutAccess = resolveMentions(["ada", "linus"], directory);
    expect(unknown).toEqual(["u1"]);
    expect(withoutAccess).toEqual(unknown);
  });
});
