import { diffArrays } from "diff";

export type LineChangeKind = "add" | "change" | "format";
export interface LineChange {
  kind?: LineChangeKind;
  deletedBefore: number;
  deletedAfter: number;
}

const normalize = (text: string) => text.replaceAll("\r\n", "\n");
// Indentation and whitespace within a line can carry meaning in source files.
const contentKey = (line: string) => line.replace(/[\t ]+$/, "");
function lines(text: string) {
  if (!text) return [];
  const result = normalize(text).split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

export function lineChanges(before: string, after: string) {
  const oldLines = lines(before),
    newLines = lines(after);
  const markers: LineChange[] = Array.from(
    { length: normalize(after).split("\n").length },
    () => ({ deletedBefore: 0, deletedAfter: 0 }),
  );
  const parts = diffArrays(oldLines, newLines, {
    comparator: (a, b) => contentKey(a) === contentKey(b),
    timeout: 150,
  }) || [
    { value: oldLines, count: oldLines.length, removed: true, added: false },
    { value: newLines, count: newLines.length, removed: false, added: true },
  ];
  const included: string[] = [];
  let oldLine = 0,
    newLine = 0;
  function pair() {
    const old = oldLines[oldLine++],
      next = newLines[newLine];
    const formatting = contentKey(old) === contentKey(next);
    if (old !== next) markers[newLine].kind = formatting ? "format" : "change";
    included.push(formatting ? old : next);
    newLine++;
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.removed) {
      const removed = part.value.length;
      const added = parts[i + 1]?.added ? parts[++i].value.length : 0;
      const paired = Math.min(removed, added);
      for (let n = 0; n < paired; n++) pair();
      for (let n = paired; n < added; n++) {
        markers[newLine].kind = "add";
        included.push(newLines[newLine++]);
      }
      if (removed > paired) {
        const anchor = Math.min(newLine, markers.length - 1);
        const side =
          newLine < markers.length ? "deletedBefore" : "deletedAfter";
        markers[anchor][side] += removed - paired;
        oldLine += removed - paired;
      }
    } else if (part.added) {
      for (let n = 0; n < part.value.length; n++) {
        markers[newLine].kind = "add";
        included.push(newLines[newLine++]);
      }
    } else {
      for (let n = 0; n < part.value.length; n++) pair();
    }
  }
  const oldFinalNewline = before.endsWith("\n");
  const newFinalNewline = after.endsWith("\n");
  if (
    oldLines.length &&
    newLines.length &&
    oldFinalNewline !== newFinalNewline
  ) {
    const last = newLines.length - 1;
    markers[last].kind ||= "format";
  }
  // Preserve the base file's line-ending convention and final-newline choice.
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = oldLines.length ? oldFinalNewline : newFinalNewline;
  const commitText =
    included.join(eol) + (included.length && finalNewline ? eol : "");
  return { markers, commitText };
}
