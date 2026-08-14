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
         BASIC VALIDATION
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
         DATE FORMAT VALIDATION
         Expected format: YYYY-MM-DD
      -------------------------------------- */

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid date format."
          });

      }


      /* --------------------------------------
         SERVER-SIDE DATE VALIDATION
         Prevent dates before today.
         
         IMPORTANT:
         This uses the server's local date.
         Since your app is intended for India,
         we explicitly calculate today's date
         using Asia/Kolkata.
      -------------------------------------- */

      function getTodayIndia() {

        const formatter =
          new Intl.DateTimeFormat(
            "en-CA",
            {
              timeZone: "Asia/Kolkata",
              year: "numeric",
              month: "2-digit",
              day: "2-digit"
            }
          );

        return formatter.format(
          new Date()
        );

      }


      const todayIndia =
        getTodayIndia();


      if (date < todayIndia) {

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
        VALUES ($1, $2, $3)
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

          const {
            data,
            error
          } = await resend.emails.send({

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


          /* --------------------------------------
             CHECK RESEND RESPONSE
          -------------------------------------- */

          if (error) {

            console.error(
              "RESEND ERROR:",
              error
            );

          } else {

            console.log(
              "RESEND SUCCESS:",
              data
            );

          }


        } catch (emailError) {

          console.error(
            "RESEND EXCEPTION:",
            emailError
          );

        }

      } else {

        console.warn(
          "NO CREATOR EMAIL FOUND FOR INVITATION:",
          invitationCode
        );

      }


      /* --------------------------------------
         RESPONSE TO BROWSER
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
