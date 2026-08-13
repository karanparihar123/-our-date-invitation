# Our Date Invitation ❤️

This is a ready-to-deploy Node.js + Express website with a PostgreSQL backend.

## Easiest deployment

1. Create a GitHub account/repository.
2. Upload all files from this project to the repository.
3. In Render, choose New → Blueprint.
4. Connect the GitHub repository.
5. Render reads `render.yaml` and creates the web service + database.
6. Open the generated `onrender.com` URL.

## Viewing the saved response

Render generates a private ADMIN_KEY automatically. In the Render service's Environment page, copy the value of `ADMIN_KEY`.

Open:
`https://YOUR-SITE.onrender.com/api/responses?key=YOUR_ADMIN_KEY`

It will show the saved answer and selected date.

Note: Render currently offers free web services and free Postgres for hobby/testing use, but its free Postgres expires after 30 days. The database should therefore be upgraded or replaced if you want the response stored permanently beyond that period.
