import { parseMarkdown, type Inline } from "./markdown-utils";

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((seg, i) =>
        seg.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {seg.text}
          </strong>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

// Renders the AI report markdown as polished prose in the app's light theme.
// Tolerant of partial input while streaming.
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          return (
            <h3
              key={i}
              className="font-sans text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              <Inlines inlines={b.inlines} />
            </h3>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="space-y-1.5">
              {b.items.map((item, j) => (
                <li
                  key={j}
                  className="flex gap-2 font-sans text-[13px] leading-relaxed text-foreground"
                >
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span>
                    <Inlines inlines={item} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={i}
            className="font-sans text-[13px] leading-relaxed text-foreground"
          >
            <Inlines inlines={b.inlines} />
          </p>
        );
      })}
    </div>
  );
}
