const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const { Resend } = require("resend");

const app = express();

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

const resend = new Resend(RESEND_API_KEY);

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

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* ==========================================
   SAVE DATE RESPONSE
========================================== */

app.post("/api/response", async (req, res) => {
  try {
    const { answer, date } = req.body || {};

    if (!["yes", "no"].includes(answer) || !date) {
      return res.status(400).json({
        error: "Invalid response."
      });
    }

    await pool.query(
      `
      INSERT INTO responses
      (answer, selected_date)
      VALUES ($1, $2)
      `,
      [answer, date]
    );

    /* ==========================================
       SEND EMAIL NOTIFICATION
    ========================================== */

    const formattedDate =
      new Date(date + "T00:00:00")
        .toLocaleDateString("en-IN", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        });

    try {
      await resend.emails.send({
        from: "Our Date Invitation <onboarding@resend.dev>",

        to: ["karanparihar.iimt@gmail.com"],

        subject: "❤️ Your Date Has Been Booked!",

        html: `
          <div style="
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: auto;
            padding: 30px;
            text-align: center;
            background: #fff5f7;
            border-radius: 20px;
          ">

            <h1 style="color:#941f5a;">
              💖 It's a date!
            </h1>

            <p style="font-size:18px;">
              Someone just booked a date with you. 🥰
            </p>

            <div style="
              background:white;
              padding:20px;
              border-radius:15px;
              margin:25px 0;
            ">

              <p style="font-size:16px;">
                📅 <strong>Date</strong>
              </p>

              <p style="
                font-size:22px;
                color:#941f5a;
                font-weight:bold;
              ">
                ${formattedDate}
              </p>

            </div>

            <p style="font-size:16px;">
              Your date invitation has officially been accepted. ❤️
            </p>

            <p style="font-size:14px;color:#777;">
              Booked through Our Date Invitation
            </p>

          </div>
        `
      });

      console.log("Notification email sent.");

    } catch (emailError) {
      console.error(
        "Email notification failed:",
        emailError
      );
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Could not save response."
    });
  }
});


/* ==========================================
   VIEW SAVED RESPONSES
========================================== */

app.get("/api/responses", async (req, res) => {

  if (
    !ADMIN_KEY ||
    req.query.key !== ADMIN_KEY
  ) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  try {

    const result = await pool.query(`
      SELECT
        answer,
        selected_date,
        created_at
      FROM responses
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Could not load responses."
    });

  }

});


/* ==========================================
   WEBSITE ROUTES
========================================== */

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});

app.get("/invitation", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "invitation.html"
    )
  );

});


/* ==========================================
   START SERVER
========================================== */

initDb()
  .then(() => {

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Running on ${PORT}`
        );

      }
    );

  })
  .catch(err => {

    console.error(
      "Database initialization failed:",
      err
    );

    process.exit(1);

  });
