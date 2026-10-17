import type { Commit } from "../shared/types";

export interface GraphLine {
  from: number;
  to: number;
  color: string;
  start: boolean;
  end: boolean;
  /** The actual commit at the other end, including parents outside this result. */
  targetHash?: string;
  dashed?: boolean;
  /** An unavailable parent ends at the row boundary, never at another node. */
  boundary?: boolean;
}

export interface GraphRow {
  lane: number;
  color: string;
  lines: GraphLine[];
  width: number;
}

export interface LogGraphItem {
  /** Stable expansion key; also the representative commit's hash. */
  id: string;
  commit: Commit;
  /** Empty on ordinary rows; includes the representative on collapsed rows. */
  hidden: Commit[];
}

export interface LogGraphOptions {
  collapseLinear: boolean;
  expanded: ReadonlySet<string>;
  selected?: string;
}

export interface LogGraph {
  items: LogGraphItem[];
  graph: GraphRow[];
  /** Includes hidden commits, which map to their collapsed display row. */
  hashToRow: Map<string, number>;
}

const colors = [
  "#9aa43b",
  "#6aab73",
  "#6e9bf7",
  "#c792ea",
  "#de7885",
  "#60bfc1",
];

interface Lane {
  hash: string;
  color: string;
}

/** Work is linear in the input edges and the emitted lane segments. */
function layoutGraph(
  commits: Commit[],
  fixedColors?: ReadonlyMap<string, string>,
): GraphRow[] {
  const positions = new Map(commits.map((commit, row) => [commit.hash, row]));
  let lanes: Lane[] = [];
  let colorIndex = 0;
  const allocateColor = (hash: string): string => {
    const fallback = colors[colorIndex++ % colors.length];
    return fixedColors?.get(hash) ?? fallback;
  };

  return commits.map((commit, row) => {
    const previousPositions = new Map(lanes.map((entry, i) => [entry.hash, i]));
    const incomingLane = previousPositions.get(commit.hash);
    const lane = incomingLane ?? lanes.length;
    const color =
      incomingLane === undefined
        ? allocateColor(commit.hash)
        : lanes[incomingLane].color;
    const previous = lanes;
    const remaining = previous.filter((entry) => entry.hash !== commit.hash);
    const nextHashes = new Set(remaining.map((entry) => entry.hash));
    const parents = [...new Set(commit.parents)];
    const newParents: Lane[] = [];

    parents.forEach((hash, parentIndex) => {
      const targetRow = positions.get(hash);
      if (targetRow === undefined || targetRow <= row || nextHashes.has(hash))
        return;
      newParents.push({
        hash,
        color:
          fixedColors?.get(hash) ?? (parentIndex ? allocateColor(hash) : color),
      });
      nextHashes.add(hash);
    });

    const insertion = Math.min(lane, remaining.length);
    const next = [
      ...remaining.slice(0, insertion),
      ...newParents,
      ...remaining.slice(insertion),
    ];

    const nextPositions = new Map(next.map((entry, i) => [entry.hash, i]));
    const lines: GraphLine[] = [];
    previous.forEach((entry, from) => {
      if (entry.hash === commit.hash) return;
      const to = nextPositions.get(entry.hash);
      if (to !== undefined) {
        lines.push({
          from,
          to,
          color: entry.color,
          start: false,
          end: false,
          targetHash: entry.hash,
        });
      }
    });
    if (incomingLane !== undefined) {
      lines.push({
        from: lane,
        to: lane,
        color,
        start: false,
        end: true,
        targetHash: commit.hash,
      });
    }
    parents.forEach((hash, parentIndex) => {
      const targetRow = positions.get(hash);
      const to =
        targetRow !== undefined && targetRow > row
          ? nextPositions.get(hash)
          : undefined;
      if (to === undefined) {
        lines.push({
          from: lane,
          to: lane,
          color,
          start: true,
          end: false,
          targetHash: hash,
          dashed: true,
          boundary: true,
        });
      } else {
        lines.push({
          from: lane,
          to,
          color: parentIndex ? next[to].color : color,
          start: true,
          end: false,
          targetHash: hash,
        });
      }
    });
    lanes = next;
    return {
      lane,
      color,
      lines,
      width: Math.max(previous.length, next.length, lane + 1),
    };
  });
}

/** Compatibility entry point: every input commit has exactly one output row. */
export function graphRows(commits: Commit[]): GraphRow[] {
  return layoutGraph(commits);
}

/**
 * Collapse only adjacent rows that also form a real single-child/single-parent
 * chain. Ref nodes, merges, forks, roots and loaded-history boundaries survive.
 * Selecting any member expands its complete segment for keyboard navigation.
 * Neither the commits nor their parent/ref fields are modified.
 */
export function buildLogGraph(
  commits: Commit[],
  options: LogGraphOptions,
): LogGraph {
  const originalGraph = graphRows(commits);
  const items: LogGraphItem[] = [];
  const hashToRow = new Map<string, number>();
  const positions = new Map(commits.map((commit, row) => [commit.hash, row]));
  const childCounts = new Map<string, number>();
  for (const commit of commits) {
    for (const parent of new Set(commit.parents)) {
      if (positions.has(parent))
        childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  }

  const collapsible = (commit: Commit, row: number): boolean => {
    const parentRow = positions.get(commit.parents[0]);
    return (
      !commit.refs?.trim() &&
      commit.parents.length === 1 &&
      childCounts.get(commit.hash) === 1 &&
      parentRow !== undefined &&
      parentRow > row
    );
  };
  const append = (commit: Commit, hidden: Commit[] = []): void => {
    const row = items.length;
    items.push({ id: commit.hash, commit, hidden });
    if (hidden.length) {
      for (const member of hidden) hashToRow.set(member.hash, row);
    } else {
      hashToRow.set(commit.hash, row);
    }
  };

  for (let index = 0; index < commits.length;) {
    const first = index;
    if (options.collapseLinear && collapsible(commits[index], index)) {
      while (
        index + 1 < commits.length &&
        commits[index].parents[0] === commits[index + 1].hash &&
        collapsible(commits[index + 1], index + 1)
      )
        index++;
    }
    const segment = commits.slice(first, index + 1);
    const expanded = segment.some(
      (commit) =>
        options.expanded.has(commit.hash) || commit.hash === options.selected,
    );
    if (segment.length >= 2 && !expanded) {
      append(segment[0], segment);
    } else {
      for (const commit of segment) append(commit);
    }
    index++;
  }

  if (items.length === commits.length)
    return { items, graph: originalGraph, hashToRow };

  // Colors come from the entire loaded history, independent of expansion and
  // virtual scroll windows. Only display edges skip the collapsed linear nodes.
  const fixedColors = new Map(
    commits.map((commit, row) => [commit.hash, originalGraph[row].color]),
  );
  const displayCommits = items.map((item) => {
    const tail = item.hidden.length
      ? item.hidden[item.hidden.length - 1]
      : item.commit;
    const parents = tail.parents.map((hash) => {
      const row = hashToRow.get(hash);
      return row === undefined ? hash : items[row].commit.hash;
    });
    return { ...item.commit, parents };
  });
  return { items, graph: layoutGraph(displayCommits, fixedColors), hashToRow };
}
