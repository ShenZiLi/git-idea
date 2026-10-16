import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
  sourcemap: true,
});
