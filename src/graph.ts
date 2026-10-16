import type { Commit } from "../shared/types";
export interface GraphRow {
  lane: number;
  color: string;
  lines: {
    from: number;
    to: number;
    color: string;
    start: boolean;
    end: boolean;
  }[];
  width: number;
}
const colors = [
  "#d5a363",
  "#6aab73",
  "#6e9bf7",
  "#c792ea",
  "#de7885",
  "#60bfc1",
];
export function graphRows(commits: Commit[]): GraphRow[] {
  let lanes: { hash: string; color: string }[] = [],
    colorIndex = 0;
  return commits.map((commit) => {
    let lane = lanes.findIndex((l) => l.hash === commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({
        hash: commit.hash,
        color: colors[colorIndex++ % colors.length],
      });
    }
    const color = lanes[lane].color,
      previous = [...lanes],
      next = lanes.filter((l) => l.hash !== commit.hash);
    commit.parents.forEach((hash, i) => {
      if (!next.some((l) => l.hash === hash))
        next.splice(Math.min(lane + i, next.length), 0, {
          hash,
          color: i ? colors[colorIndex++ % colors.length] : color,
        });
    });
    const lines: GraphRow["lines"] = previous
      .filter((l) => l.hash !== commit.hash)
      .map((l) => ({
        from: previous.indexOf(l),
        to: next.findIndex((n) => n.hash === l.hash),
        color: l.color,
        start: false,
        end: false,
      }));
    lines.push({ from: lane, to: lane, color, start: false, end: true });
    commit.parents.forEach((hash) => {
      const i = next.findIndex((l) => l.hash === hash);
      lines.push({
        from: lane,
        to: i,
        color: next[i].color,
        start: true,
        end: false,
      });
    });
    lanes = next;
    return {
      lane,
      color,
      lines,
      width: Math.max(previous.length, next.length, 1),
    };
  });
}
