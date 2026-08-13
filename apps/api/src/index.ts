import express from "express";
import cors from "cors";
import "dotenv/config";
import balanceRouter from "./routes/balance";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", balanceRouter);

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});