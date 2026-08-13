const express = require("express");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      answer TEXT NOT NULL,
      selected_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/response", async (req, res) => {
  try {
    const { answer, date } = req.body || {};
    if (!["yes", "no"].includes(answer) || !date) {
      return res.status(400).json({ error: "Invalid response." });
    }
    await pool.query(
      "INSERT INTO responses (answer, selected_date) VALUES ($1, $2)",
      [answer, date]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save response." });
  }
});

app.get("/api/responses", async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  try {
    const result = await pool.query(
      "SELECT answer, selected_date, created_at FROM responses ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load responses." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`Running on ${PORT}`)))
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
