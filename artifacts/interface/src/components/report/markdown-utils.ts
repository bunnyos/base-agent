// A tiny, tolerant markdown parser for the AI report. Produces a flat block
// list that both the on-screen renderer (DOM) and the PDF renderer consume, so
// the two stay perfectly consistent. Intentionally minimal: headings, bullet
// lists, paragraphs, and inline **bold**. It tolerates partial/streaming input
// (e.g. an unclosed **bold**) without throwing.

export type Inline = { text: string; bold: boolean };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; items: Inline[][] };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  // Split on ** delimiters; odd segments are bold. A trailing unclosed ** just
  // renders the rest as bold, which is fine for streaming.
  const parts = src.split("**");
  for (let i = 0; i < parts.length; i++) {
    const text = parts[i];
    if (text === "") continue;
    out.push({ text, bold: i % 2 === 1 });
  }
  if (out.length === 0) out.push({ text: "", bold: false });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  let listItems: Inline[][] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join(" ").trim()) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, inlines: parseInline(heading[2].trim()) });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      listItems.push(parseInline(bullet[1].trim()));
      continue;
    }

    // Plain text line: accumulate into the current paragraph (and end any list).
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

// Flattens inline runs to plain text — used for the PDF document title and any
// place that needs the raw string of a block.
export function inlineText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join("");
}
