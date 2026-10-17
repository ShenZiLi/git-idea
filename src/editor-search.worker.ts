export interface SearchMatch {
  start: number;
  end: number;
  replacement: string;
}
export interface SearchQuery {
  text: string;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}
export interface SearchResult {
  matches: SearchMatch[];
  error?: string;
  limited?: boolean;
}

// Run user supplied regular expressions off the UI thread so they can be cancelled.
self.onmessage = ({ data }: MessageEvent<SearchQuery>) => {
  const { text, query, replacement, caseSensitive, wholeWord, regex } = data;
  try {
    let pattern = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord)
      pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
    const expression = new RegExp(pattern, caseSensitive ? "gu" : "giu");
    const matches: SearchMatch[] = [];
    let replacementSize = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text))) {
      const found = match;
      const expanded = regex
        ? replacement.replace(
            /\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g,
            (token, key: string) => {
              if (key === "$") return "$";
              if (key === "&") return found[0];
              if (key === "`") return text.slice(0, found.index);
              if (key === "'") return text.slice(found.index + found[0].length);
              if (key.startsWith("<"))
                return found.groups
                  ? (found.groups[key.slice(1, -1)] ?? "")
                  : token;
              const index = Number(key);
              if (index > 0 && index < found.length) return found[index] ?? "";
              if (
                key.length === 2 &&
                Number(key[0]) > 0 &&
                Number(key[0]) < found.length
              )
                return (found[Number(key[0])] ?? "") + key[1];
              return token;
            },
          )
        : replacement;
      replacementSize += expanded.length;
      if (replacementSize > 4 * 1024 * 1024) {
        self.postMessage({
          matches: [],
          error: "替换结果过大，请缩小查找范围",
        } satisfies SearchResult);
        return;
      }
      matches.push({
        start: found.index,
        end: found.index + found[0].length,
        replacement: expanded,
      });
      if (!found[0].length)
        expression.lastIndex +=
          (text.codePointAt(expression.lastIndex) ?? 0) > 0xffff ? 2 : 1;
      if (matches.length >= 20000) {
        self.postMessage({
          matches,
          limited: expression.exec(text) !== null,
        } satisfies SearchResult);
        return;
      }
    }
    self.postMessage({ matches } satisfies SearchResult);
  } catch (cause) {
    self.postMessage({
      matches: [],
      error: `正则表达式无效：${(cause as Error).message}`,
    } satisfies SearchResult);
  }
};
