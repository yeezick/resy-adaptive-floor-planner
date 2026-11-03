import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(here, "../client");
  app.use(express.static(clientDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3001);
  createApp().listen(port, () => {
    console.log(JSON.stringify({ msg: "listening", port }));
  });
}
