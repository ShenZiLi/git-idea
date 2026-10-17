import atlas from "../assets/idea-sidebar-atlas.png";

const cells = {
  project: [0, 0],
  commit: [1, 0],
  branch: [2, 0],
  log: [3, 0],
  terminal: [0, 1],
  help: [1, 1],
  changes: [2, 1],
  notification: [3, 1],
  stash: [0, 2],
  sun: [1, 2],
  moon: [2, 2],
  settings: [3, 2],
} as const;

// Use the generated atlas as a luminance mask so one asset follows every theme.
export function SidebarIcon({ name }: { name: keyof typeof cells }) {
  const [column, row] = cells[name];
  return (
    <span
      className="sidebar-icon"
      aria-hidden="true"
      style={{
        maskImage: `url("${atlas}")`,
        maskPosition: `${(column / 3) * 100}% ${(row / 2) * 100}%`,
      }}
    />
  );
}
