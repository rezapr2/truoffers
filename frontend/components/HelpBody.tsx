/**
 * Help pages are plain text written in the admin panel: a blank line starts a paragraph, "## " a heading and
 * "- " a list item. Rendered as text only, never as HTML.
 */
export default function HelpBody({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-4 text-[15.5px] leading-relaxed text-ink-soft">
      {blocks.map((block, i) => {
        if (block.startsWith('## ')) {
          return (
            <h2 key={i} className="font-display text-xl font-extrabold text-ink mt-4">
              {block.slice(3)}
            </h2>
          );
        }
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={i} className="list-disc pl-6 flex flex-col gap-1.5">
              {lines.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}
