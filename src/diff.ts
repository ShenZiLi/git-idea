import { diffLines } from "diff";
export interface DiffRow {
  before?: string;
  after?: string;
  oldNumber?: number;
  newNumber?: number;
  kind: "same" | "change" | "add" | "delete";
}
export function diffRows(
  before: string,
  after: string,
  ignoreWhitespace = false,
): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1,
    newLine = 1;
  const parts = diffLines(
    before.replaceAll("\r\n", "\n"),
    after.replaceAll("\r\n", "\n"),
    { ignoreWhitespace },
  );
  const lines = (text: string) => {
    const result = text.split("\n");
    if (result.at(-1) === "") result.pop();
    return result;
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.removed) {
      const removed = lines(p.value),
        added = parts[i + 1]?.added ? lines(parts[++i].value) : [];
      for (let n = 0; n < Math.max(removed.length, added.length); n++)
        rows.push({
          before: removed[n],
          after: added[n],
          oldNumber: removed[n] !== undefined ? oldLine++ : undefined,
          newNumber: added[n] !== undefined ? newLine++ : undefined,
          kind:
            added[n] === undefined
              ? "delete"
              : removed[n] === undefined
                ? "add"
                : "change",
        });
    } else if (p.added)
      for (const text of lines(p.value))
        rows.push({ after: text, newNumber: newLine++, kind: "add" });
    else
      for (const text of lines(p.value))
        rows.push({
          before: text,
          after: text,
          oldNumber: oldLine++,
          newNumber: newLine++,
          kind: "same",
        });
  }
  return rows;
}
