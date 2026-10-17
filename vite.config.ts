import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createApi } from "./electron/api.ts";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "local-git-api",
      configureServer(server) {
        const api = createApi({
          defaultRepo: process.cwd(),
          preferencesPath: process.env.GIT_IDEA_PREFERENCES,
        });
        server.middlewares.use("/api/git", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          const origin = req.headers.origin;
          if (origin && origin !== `http://${req.headers.host}`) {
            res.statusCode = 403;
            res.end();
            return;
          }
          if (
            !String(req.headers["content-type"]).startsWith("application/json")
          ) {
            res.statusCode = 415;
            res.end();
            return;
          }
          try {
            let body = "";
            for await (const chunk of req) {
              body += chunk.toString();
              // Autosave includes both the new text and the expected disk text.
              if (body.length > 12 * 1024 * 1024) throw new Error("请求过大");
            }
            const data = await api(JSON.parse(body));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ data }));
          } catch (error) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
