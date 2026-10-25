import { load } from "cheerio/slim";
import { WEB_FETCH_LIMITS } from "@kintsugi/domain";
import { publicWebUrl } from "../http/public-web.js";

export const cleanWebText = (value: string): string => value.replace(/\r\n?/g, "\n").replace(/[\p{Cc}\p{Cf}]/gu, (char) => char === "\n" || char === "\t" ? char : "");
export function extractWebContent(text: string, contentType: string, finalUrl: string): { title: string; content: string; sourceTruncated: boolean; links: Array<{ title: string; url: string }> } {
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)) {
    const clean = cleanWebText(text).trim();
    return { title: "", content: clean.slice(0, WEB_FETCH_LIMITS.contentChars), sourceTruncated: clean.length > WEB_FETCH_LIMITS.contentChars, links: [] };
  }
  const $ = load(text);
  const title = cleanWebText($("title").first().text() || $("h1").first().text()).replace(/\s+/g, " ").trim().slice(0, 300);
  $("script,style,noscript,template,iframe,object,embed,svg,canvas,form,button,input,select,textarea,nav,footer,aside,[hidden],[aria-hidden='true']").remove();
  const main = $("main,article,[role='main']").filter((_index, node) => $(node).text().trim().length >= 200).first();
  const root = $.root();
  const selected = main.length > 0 ? main : $("body").first();
  if (selected.length > 0) { selected.remove(); root.empty().append(selected); }
  const links: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  root.find("a[href]").each((_index, node) => {
    if (links.length >= WEB_FETCH_LIMITS.links) return;
    const anchor = $(node);
    try {
      const href = anchor.attr("href");
      if (href === undefined || href.startsWith("#")) return;
      const url = publicWebUrl(new URL(href, finalUrl).href).href;
      if (seen.has(url)) return;
      seen.add(url);
      links.push({ title: cleanWebText(anchor.text()).replace(/\s+/g, " ").trim().slice(0, 160), url });
    } catch { /* Do not return private, signed, credential-bearing or malformed links. */ }
  });
  root.find("pre").prepend("\n\n```\n").append("\n```\n\n");
  root.find("br").replaceWith("\n");
  root.find("h1,h2,h3,h4,h5,h6").each((_index, node) => { $(node).prepend(`\n\n${"#".repeat(Number(node.tagName.slice(1)))} `).append("\n\n"); });
  root.find("li").prepend("\n- ");
  root.find("th,td").append("\t");
  root.find("p,div,section,article,main,ul,ol,blockquote,tr,table").append("\n\n");
  const content = cleanWebText(root.text()).split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, content: content.slice(0, WEB_FETCH_LIMITS.contentChars), sourceTruncated: content.length > WEB_FETCH_LIMITS.contentChars, links };
}
