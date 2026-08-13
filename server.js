const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const { Resend } = require("resend");

const app = express();

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;


/* ==========================================
   ENVIRONMENT CHECKS
========================================== */

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY is missing.");
  process.exit(1);
}


/* ==========================================
   DATABASE
========================================== */

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});


/* ==========================================
   RESEND
========================================== */

const resend = new Resend(RESEND_API_KEY);


/* ==========================================
   DATABASE INITIALIZATION
========================================== */

async function initDb() {

  /* ------------------------------------------
     INVITATIONS TABLE
  ------------------------------------------ */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      invitation_code VARCHAR(20) UNIQUE NOT NULL,
      creator_name TEXT NOT NULL,
      creator_email TEXT,
      recipient_name TEXT NOT NULL,
      occasion TEXT NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);


  /* ------------------------------------------
     ADD EMAIL TO EXISTING TABLE
  ------------------------------------------ */

  await pool.query(`
    ALTER TABLE invitations
    ADD COLUMN IF NOT EXISTS creator_email TEXT
  `);


  /* ------------------------------------------
     RESPONSES TABLE
  ------------------------------------------ */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      invitation_code VARCHAR(20),
      answer TEXT NOT NULL,
      selected_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);


  /* ------------------------------------------
     RESPONSE TABLE MIGRATION
  ------------------------------------------ */

  await pool.query(`
    ALTER TABLE responses
    ADD COLUMN IF NOT EXISTS invitation_code VARCHAR(20)
  `);


  console.log(
    "Database initialized successfully."
  );

}


/* ==========================================
   MIDDLEWARE
========================================== */

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* ==========================================
   CREATE INVITATION
========================================== */

app.post(
  "/api/invitations",
  async (req, res) => {

    try {

      const {
        creatorName,
        creatorEmail,
        recipientName,
        occasion,
        message
      } = req.body || {};


      /* --------------------------------------
         VALIDATION
      -------------------------------------- */

      if (
        !creatorName ||
        !creatorEmail ||
        !recipientName ||
        !occasion
      ) {

        return res
          .status(400)
          .json({
            error:
              "Please complete all required fields."
          });

      }


      /* --------------------------------------
         EMAIL VALIDATION
      -------------------------------------- */

      const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


      if (
        !emailPattern.test(
          creatorEmail.trim()
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "Please enter a valid email address."
          });

      }


      /* --------------------------------------
         GENERATE UNIQUE CODE
      -------------------------------------- */

      let invitationCode;

      let isUnique = false;


      while (!isUnique) {

        invitationCode =
          Math.random()
            .toString(36)
            .substring(2, 10);


        const existing =
          await pool.query(
            `
            SELECT id
            FROM invitations
            WHERE invitation_code = $1
            `,
            [invitationCode]
          );


        if (
          existing.rows.length === 0
        ) {

          isUnique = true;

        }

      }


      /* --------------------------------------
         SAVE INVITATION
      -------------------------------------- */

      await pool.query(
        `
        INSERT INTO invitations (
          invitation_code,
          creator_name,
          creator_email,
          recipient_name,
          occasion,
          message
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          invitationCode,
          creatorName.trim(),
          creatorEmail.trim(),
          recipientName.trim(),
          occasion,
          message
            ? message.trim()
            : null
        ]
      );


      /* --------------------------------------
         CREATE SHAREABLE URL
      -------------------------------------- */

      const invitationUrl =
        `${req.protocol}://${req.get("host")}/i/${invitationCode}`;


      res.json({
        ok: true,
        invitationCode,
        invitationUrl
      });


    } catch (err) {

      console.error(
        "Could not create invitation:",
        err
      );


      res
        .status(500)
        .json({
          error:
            "Could not create invitation."
        });

    }

  }
);


/* ==========================================
   GET PERSONALIZED INVITATION
========================================== */

app.get(
  "/api/invitations/:code",
  async (req, res) => {

    try {

      const code =
        req.params.code;


      const result =
        await pool.query(
          `
          SELECT
            invitation_code,
            creator_name,
            recipient_name,
            occasion,
            message,
            created_at
          FROM invitations
          WHERE invitation_code = $1
          `,
          [code]
        );


      if (
        result.rows.length === 0
      ) {

        return res
          .status(404)
          .json({
            error:
              "Invitation not found."
          });

      }


      res.json(
        result.rows[0]
      );


    } catch (err) {

      console.error(
        "Could not load invitation:",
        err
      );


      res
        .status(500)
        .json({
          error:
            "Could not load invitation."
        });

    }

  }
);


/* ==========================================
   SAVE DATE RESPONSE
========================================== */

app.post(
  "/api/response",
  async (req, res) => {

    try {

      const {
        answer,
        date,
        invitationCode
      } = req.body || {};


      /* --------------------------------------
         VALIDATION
      -------------------------------------- */

      if (
        !["yes", "no"].includes(answer) ||
        !date
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid response."
          });

      }


      /* --------------------------------------
         SAVE RESPONSE
      -------------------------------------- */

      await pool.query(
        `
        INSERT INTO responses (
          invitation_code,
          answer,
          selected_date
        )
        VALUES ($1, $2, $3)
        `,
        [
          invitationCode || null,
          answer,
          date
        ]
      );


      /* --------------------------------------
         FIND CREATOR EMAIL
      -------------------------------------- */

      let creatorEmail = null;
      let creatorName = null;
      let recipientName = null;


      if (invitationCode) {

        const invitationResult =
          await pool.query(
            `
            SELECT
              creator_email,
              creator_name,
              recipient_name
            FROM invitations
            WHERE invitation_code = $1
            `,
            [invitationCode]
          );


        if (
          invitationResult.rows.length > 0
        ) {

          creatorEmail =
            invitationResult.rows[0]
              .creator_email;

          creatorName =
            invitationResult.rows[0]
              .creator_name;

          recipientName =
            invitationResult.rows[0]
              .recipient_name;

        }

      }


      /* --------------------------------------
         FORMAT DATE
      -------------------------------------- */

      const formattedDate =
        new Date(
          date + "T00:00:00"
        ).toLocaleDateString(
          "en-IN",
          {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
          }
        );


      /* ======================================
         SEND EMAIL TO CREATOR
      ====================================== */

      if (creatorEmail) {

        try {

          await resend.emails.send({

            from:
              "Our Date Invitation <onboarding@resend.dev>",

            to: [
              creatorEmail
            ],

            subject:
              "❤️ Your Date Has Been Booked!",

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
                  ${recipientName || "Someone"}
                  just booked a date with you. 🥰
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
                  ">
                    ${formattedDate}
                  </p>

                </div>

                <p>
                  Your invitation has officially
                  been responded to. ❤️
                </p>

                <p>
                  Booked through Moment ❤️
                </p>

              </div>
            `

          });


          console.log(
            `Notification email sent to ${creatorEmail}`
          );


        } catch (emailError) {

          console.error(
            "Email notification failed:",
            emailError
          );

        }

      } else {

        console.warn(
          "No creator email found for invitation:",
          invitationCode
        );

      }


      /* --------------------------------------
         RESPONSE
      -------------------------------------- */

      res.json({
        ok: true
      });


    } catch (err) {

      console.error(
        "Could not save response:",
        err
      );


      res
        .status(500)
        .json({
          error:
            "Could not save response."
        });

    }

  }
);


/* ==========================================
   VIEW SAVED RESPONSES
========================================== */

app.get(
  "/api/responses",
  async (req, res) => {

    if (
      !ADMIN_KEY ||
      req.query.key !== ADMIN_KEY
    ) {

      return res
        .status(401)
        .json({
          error:
            "Unauthorized."
        });

    }


    try {

      const result =
        await pool.query(
          `
          SELECT
            invitation_code,
            answer,
            selected_date,
            created_at
          FROM responses
          ORDER BY created_at DESC
          `
        );


      res.json(
        result.rows
      );


    } catch (err) {

      console.error(err);


      res
        .status(500)
        .json({
          error:
            "Could not load responses."
        });

    }

  }
);


/* ==========================================
   PERSONALIZED INVITATION PAGE
========================================== */

app.get(
  "/i/:code",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "invitation.html"
      )
    );

  }
);


/* ==========================================
   WEBSITE ROUTES
========================================== */

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);


app.get(
  "/invitation",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "invitation.html"
      )
    );

  }
);


app.get(
  "/create",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "create.html"
      )
    );

  }
);


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
