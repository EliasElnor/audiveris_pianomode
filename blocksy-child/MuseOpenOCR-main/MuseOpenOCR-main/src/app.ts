import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { router } from "./routes/index.routes.js";

export const app = express();

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(__filename);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.static(path.join(_dirname, "view")));
app.use(router);

app.get("/", (req, res) => {
  res.sendFile(path.join(_dirname, "view", "index.html"));
});