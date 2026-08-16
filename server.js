const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const app = express();


/* ==========================================
   CONFIGURATION
========================================== */

const PORT =
  process.env.PORT || 3000;

const DATABASE_URL =
  process.env.DATABASE_URL;

const ADMIN_KEY =
  process.env.ADMIN_KEY;

const RESEND_API_KEY =
  process.env.RESEND_API_KEY;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;


/* ==========================================
   ENVIRONMENT CHECKS
========================================== */

if (!DATABASE_URL) {

  console.error(
    "DATABASE_URL is missing."
  );

  process.exit(1);

}


if (!RESEND_API_KEY) {

  console.error(
    "RESEND_API_KEY is missing."
  );

  process.exit(1);

}


if (!SUPABASE_URL) {

  console.error(
    "SUPABASE_URL is missing."
  );

  process.exit(1);

}


if (!SUPABASE_ANON_KEY) {

  console.error(
    "SUPABASE_ANON_KEY is missing."
  );

  process.exit(1);

}


/* ==========================================
   DATABASE
========================================== */

const pool =
  new Pool({

    connectionString:
      DATABASE_URL,

    ssl:
      process.env.NODE_ENV === "production"
        ? {
            rejectUnauthorized: false
          }
        : false

  });


/* ==========================================
   SUPABASE
========================================== */

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );


/* ==========================================
   RESEND
========================================== */

const resend =
  new Resend(
    RESEND_API_KEY
  );


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
      creator_user_id UUID,
      creator_name TEXT NOT NULL,
      creator_email TEXT,
      recipient_name TEXT NOT NULL,
      occasion TEXT NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);


  /* ------------------------------------------
     ADD CREATOR USER ID TO OLD DATABASES
  ------------------------------------------ */

  await pool.query(`
    ALTER TABLE invitations
    ADD COLUMN IF NOT EXISTS creator_user_id UUID
  `);


  /* ------------------------------------------
     ADD CREATOR EMAIL TO OLD DATABASES
  ------------------------------------------ */

  await pool.query(`
    ALTER TABLE invitations
    ADD COLUMN IF NOT EXISTS creator_email TEXT
  `);


  /* ------------------------------------------
     INDEX FOR USER INVITATIONS
  ------------------------------------------ */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      invitations_creator_user_id_idx
    ON invitations (creator_user_id)
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
     ADD INVITATION CODE TO OLD DATABASES
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

app.use(
  express.json()
);


app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);


/* ==========================================
   SUPABASE AUTH MIDDLEWARE
========================================== */

async function requireAuth(
  req,
  res,
  next
) {

  try {

    const authorization =
      req.headers.authorization;


    if (
      !authorization ||
      !authorization.startsWith(
        "Bearer "
      )
    ) {

      return res
        .status(401)
        .json({

          error:
            "You must be logged in."

        });

    }


    const accessToken =
      authorization.substring(
        7
      );


    if (!accessToken) {

      return res
        .status(401)
        .json({

          error:
            "Invalid authentication token."

        });

    }


    const {
      data,
      error
    } =
      await supabase.auth.getUser(
        accessToken
      );


    if (
      error ||
      !data ||
      !data.user
    ) {

      console.error(
        "Supabase authentication failed:",
        error
      );


      return res
        .status(401)
        .json({

          error:
            "Your login session is invalid or expired."

        });

    }


    req.user =
      data.user;


    next();

  }

  catch (error) {

    console.error(
      "Authentication middleware error:",
      error
    );


    return res
      .status(401)
      .json({

        error:
          "Authentication failed."

      });

  }

}


/* ==========================================
   GET CURRENT USER
========================================== */

app.get(
  "/api/me",
  requireAuth,
  async (req, res) => {

    try {

      const user =
        req.user;


      const metadata =
        user.user_metadata || {};


      const name =
        metadata.name ||
        metadata.full_name ||
        "";


      res.json({

        ok: true,

        user: {

          id:
            user.id,

          email:
            user.email || "",

          name

        }

      });

    }

    catch (error) {

      console.error(
        "Could not load current user:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Could not load user."

        });

    }

  }
);


/* ==========================================
   CREATE INVITATION
========================================== */

app.post(
  "/api/invitations",
  requireAuth,
  async (req, res) => {

    try {

      const {

        creatorName,

        recipientName,

        occasion,

        message

      } =
        req.body || {};


      /* --------------------------------------
         AUTHENTICATED SUPABASE USER
      -------------------------------------- */

      const user =
        req.user;


      const creatorUserId =
        user.id;


      const creatorEmail =
        user.email || null;


      const metadata =
        user.user_metadata || {};


      const metadataName =
        metadata.name ||
        metadata.full_name ||
        "";


      const finalCreatorName =
        (
          creatorName ||
          metadataName
        ).trim();


      /* --------------------------------------
         VALIDATION
      -------------------------------------- */

      if (
        !finalCreatorName ||
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


      if (
        finalCreatorName.length < 2
      ) {

        return res
          .status(400)
          .json({

            error:
              "Please enter a valid creator name."

          });

      }


      if (
        recipientName.trim().length < 1
      ) {

        return res
          .status(400)
          .json({

            error:
              "Please enter the recipient name."

          });

      }


      if (
        occasion.trim().length < 1
      ) {

        return res
          .status(400)
          .json({

            error:
              "Please select an occasion."

          });

      }


      /* --------------------------------------
         GENERATE UNIQUE INVITATION CODE
      -------------------------------------- */

      let invitationCode;

      let isUnique =
        false;


      while (!isUnique) {

        invitationCode =
          Math.random()
            .toString(36)
            .substring(
              2,
              10
            );


        const existing =
          await pool.query(
            `
              SELECT id
              FROM invitations
              WHERE invitation_code = $1
            `,
            [
              invitationCode
            ]
          );


        if (
          existing.rows.length === 0
        ) {

          isUnique =
            true;

        }

      }


      /* --------------------------------------
         SAVE INVITATION
      -------------------------------------- */

      await pool.query(
        `
          INSERT INTO invitations (
            invitation_code,
            creator_user_id,
            creator_name,
            creator_email,
            recipient_name,
            occasion,
            message
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )
        `,
        [

          invitationCode,

          creatorUserId,

          finalCreatorName,

          creatorEmail,

          recipientName.trim(),

          occasion.trim(),

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


      console.log(
        "Invitation created:",
        {

          invitationCode,

          creatorUserId,

          creatorEmail

        }
      );


      res.json({

        ok: true,

        invitationCode,

        invitationUrl

      });

    }

    catch (error) {

      console.error(
        "Could not create invitation:",
        error
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
   MY MOMENTS
========================================== */

app.get(
  "/api/my-moments",
  requireAuth,
  async (req, res) => {

    try {

      const creatorUserId =
        req.user.id;


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
            WHERE creator_user_id = $1
            ORDER BY created_at DESC
          `,
          [
            creatorUserId
          ]
        );


      res.json({

        ok: true,

        moments:
          result.rows

      });

    }

    catch (error) {

      console.error(
        "Could not load My Moments:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Could not load your moments."

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
          [
            code
          ]
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


      /*
       * Do not expose:
       *
       * creator_email
       * creator_user_id
       */

      res.json(
        result.rows[0]
      );

    }

    catch (error) {

      console.error(
        "Could not load invitation:",
        error
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

      } =
        req.body || {};


      /* --------------------------------------
         BASIC VALIDATION
      -------------------------------------- */

      if (
        !["yes", "no"].includes(
          answer
        ) ||
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
         DATE FORMAT VALIDATION
      -------------------------------------- */

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          date
        )
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid date format."

          });

      }


      /* --------------------------------------
         INDIA TODAY
      -------------------------------------- */

      function getTodayIndia() {

        const formatter =
          new Intl.DateTimeFormat(
            "en-CA",
            {

              timeZone:
                "Asia/Kolkata",

              year:
                "numeric",

              month:
                "2-digit",

              day:
                "2-digit"

            }
          );


        return formatter.format(
          new Date()
        );

      }


      const todayIndia =
        getTodayIndia();


      if (
        date < todayIndia
      ) {

        return res
          .status(400)
          .json({

            error:
              "Please choose today or a future date."

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
          VALUES (
            $1,
            $2,
            $3
          )
        `,
        [

          invitationCode || null,

          answer,

          date

        ]
      );


      /* --------------------------------------
         FIND CREATOR
      -------------------------------------- */

      let creatorEmail =
        null;

      let creatorName =
        null;

      let recipientName =
        null;


      if (
        invitationCode
      ) {

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
            [
              invitationCode
            ]
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


      console.log(
        "Response received:",
        {

          invitationCode,

          answer,

          date,

          creatorEmail

        }
      );


      /* --------------------------------------
         FORMAT DATE
      -------------------------------------- */

      const formattedDate =
        new Date(
          date +
          "T00:00:00"
        ).toLocaleDateString(
          "en-IN",
          {

            weekday:
              "long",

            year:
              "numeric",

            month:
              "long",

            day:
              "numeric"

          }
        );


      /* ======================================
         SEND EMAIL TO CREATOR
      ====================================== */

      if (
        creatorEmail
      ) {

        try {

          const {

            data,

            error

          } =
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

                    ${
                      recipientName ||
                      "Someone"
                    }

                    just booked a date
                    with you. 🥰

                  </p>

                  <div style="
                    background:white;
                    padding:20px;
                    border-radius:15px;
                    margin:25px 0;
                  ">

                    <p style="font-size:16px;">

                      📅
                      <strong>
                        Date
                      </strong>

                    </p>

                    <p style="
                      font-size:22px;
                      color:#941f5a;
                    ">

                      ${formattedDate}

                    </p>

                  </div>

                  <p>

                    Your invitation has
                    officially been responded to. ❤️

                  </p>

                  <p>

                    Booked through Moment ❤️

                  </p>

                </div>

              `

            });


          if (
            error
          ) {

            console.error(
              "RESEND ERROR:",
              error
            );

          }

          else {

            console.log(
              "RESEND SUCCESS:",
              data
            );

          }

        }

        catch (emailError) {

          console.error(
            "RESEND EXCEPTION:",
            emailError
          );

        }

      }

      else {

        console.warn(
          "NO CREATOR EMAIL FOUND FOR INVITATION:",
          invitationCode
        );

      }


      /* --------------------------------------
         RESPONSE
      -------------------------------------- */

      res.json({

        ok: true

      });

    }

    catch (error) {

      console.error(
        "Could not save response:",
        error
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

    }

    catch (error) {

      console.error(
        "Could not load responses:",
        error
      );


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


/* ------------------------------------------
   LANDING PAGE
------------------------------------------ */

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


/* ------------------------------------------
   LOGIN PAGE
------------------------------------------ */

app.get(
  "/login",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "login.html"
      )

    );

  }
);


/* ------------------------------------------
   REGISTER PAGE
------------------------------------------ */

app.get(
  "/register",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "login.html"
      )

    );

  }
);


/* ------------------------------------------
   INVITATION PAGE
------------------------------------------ */

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


/* ------------------------------------------
   CREATE PAGE
------------------------------------------ */

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

  .catch(
    error => {

      console.error(
        "Database initialization failed:",
        error
      );

      process.exit(1);

    }
  );
