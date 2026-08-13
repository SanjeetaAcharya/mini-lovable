import express from "express";
import cors from "cors";
import "dotenv/config";
import balanceRouter from "./routes/balance";
import checkoutRouter from "./routes/checkout";
import webhookRouter from "./routes/webhook";
import generateRouter from "./routes/generate";

const app = express();
app.use(cors());

// Mounted before express.json() — the webhook route needs the raw body for
// Stripe signature verification and parses it itself.
app.use("/api", webhookRouter);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", balanceRouter);
app.use("/api", checkoutRouter);
app.use("/api", generateRouter);

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});