// The words of a ranked search and its matching line (P4-002), without a database.

import { describe, expect, it } from "vitest";
import { matchingLine, searchQueryOf, searchWords } from "../../src/modules/delivery/brain/domain/brain.search.js";

describe("searchWords", () => {
  it("takes the lowercase words of the text, once each, without one-letter words or operators", () => {
    expect(searchWords("Database FAILOVER steps, failover!")).toEqual(["database", "failover", "steps"]);
    expect(searchWords('a "carry over" -unused OR leave')).toEqual(["carry", "over", "unused", "leave"]);
    expect(searchWords("naïve café 2024")).toEqual(["naïve", "café", "2024"]);
    expect(searchWords("!!! (((")).toEqual([]);
  });
});

describe("searchQueryOf", () => {
  it("asks plain words as any-of, without the grammar of a question", () => {
    expect(searchQueryOf("why we use postgres")).toEqual({ kind: "any", terms: ["use", "postgres"] });
    expect(searchQueryOf("how do we rollback after payment outage")).toEqual({ kind: "any", terms: ["rollback", "after", "payment", "outage"] });
  });

  it("keeps the words when nothing else is left of the question", () => {
    expect(searchQueryOf("what is it")).toEqual({ kind: "any", terms: ["what", "is", "it"] });
    expect(searchQueryOf("!!!")).toEqual({ kind: "any", terms: [] });
  });

  it("passes a text with operators on as typed: a phrase, a word to leave out, or", () => {
    expect(searchQueryOf('"carry over" leave')).toEqual({ kind: "web", text: '"carry over" leave' });
    expect(searchQueryOf("leave -carry")).toEqual({ kind: "web", text: "leave -carry" });
    expect(searchQueryOf("failover OR failback")).toEqual({ kind: "web", text: "failover OR failback" });
    // A hyphen inside a word is not an operator.
    expect(searchQueryOf("carry-over")).toEqual({ kind: "any", terms: ["carry", "over"] });
  });
});

describe("matchingLine", () => {
  const lines = ["# Failover", "", "Check the replica first.", "Then promote it, database by database.", "Done."];

  it("gives the first line of the range that holds a word, trimmed, with its number", () => {
    expect(matchingLine(lines, 1, 5, ["database"])).toEqual({ number: 4, text: "Then promote it, database by database." });
    expect(matchingLine(lines, 1, 5, ["replica", "database"])).toEqual({ number: 3, text: "Check the replica first." });
    expect(matchingLine(lines, 1, 5, ["failover"])).toEqual({ number: 1, text: "# Failover" });
  });

  it("looks only inside the range, and says null when no line holds a word", () => {
    expect(matchingLine(lines, 5, 5, ["database"])).toBeNull();
    expect(matchingLine(lines, 1, 2, ["replica"])).toBeNull();
    expect(matchingLine(lines, 1, 5, [])).toBeNull();
    expect(matchingLine(lines, 4, 99, ["done"])).toEqual({ number: 5, text: "Done." });
    expect(matchingLine(["CRLF line\r"], 1, 1, ["crlf"])).toEqual({ number: 1, text: "CRLF line" });
  });

  it("cuts a very long line", () => {
    expect(matchingLine(["x ".repeat(500)], 1, 1, ["x"])!.text.length).toBe(300);
  });
});
