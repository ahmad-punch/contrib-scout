const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function visibleLength(text: string): number {
  return text.replace(ANSI, "").length;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

/** Render rows as a space-aligned plain-text table. The first row is the header. */
export function textTable(rows: string[][], gap = 2): string {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, col) =>
    Math.max(...rows.map((row) => visibleLength(row[col] ?? ""))),
  );
  return rows
    .map((row) =>
      row
        .map((cell, col) => (col === row.length - 1 ? cell : pad(cell, widths[col] ?? 0)))
        .join(" ".repeat(gap))
        .trimEnd(),
    )
    .join("\n");
}

export function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Render rows as a GitHub-flavoured markdown table. The first row is the header. */
export function markdownTable(rows: string[][]): string {
  const [header = [], ...body] = rows;
  const line = (cells: string[]) => `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
  return [line(header), `|${header.map(() => " --- ").join("|")}|`, ...body.map(line)].join("\n");
}
