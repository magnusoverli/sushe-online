# SuShe Online

SuShe Online is a Node.js + Express application for managing album lists with a black metal aesthetic.

## Features
- **User accounts** with registration, login and session handling using Passport.js and express-session.
- **Password reset** via email using Nodemailer.
- **Spotify-like interface** for browsing and editing your lists. Drag and drop albums to reorder and import data from MusicBrainz, iTunes and Deezer.
- **Persistent storage** using NeDB databases stored locally in the `data` directory.
- **Admin mode** protected by a rotating access code printed to the server console. Admins can view site statistics, manage users and create backups.
- **Custom theme** support allowing each user to pick an accent colour.
- **REST API** endpoints for list management and a proxy for Deezer API requests.

## Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile Tailwind CSS:
   ```bash
   npm run build:css
   ```
3. Start the server in development mode with automatic reload and CSS watch:
   ```bash
   npm run dev
   ```
4. Alternatively, run `npm start` to launch the server without watchers.

## Environment variables
- `SESSION_SECRET` – session encryption secret.
- `DATA_DIR` – directory where NeDB stores databases (`./data` by default).
- `SENDGRID_API_KEY` – optional API key for sending password reset emails. If omitted, reset links are logged to the console.
- `BASE_URL` – base URL used in password reset emails (`http://localhost:3000` by default).
- `PORT` – server port (defaults to `3000`).

## Running with Docker
A `Dockerfile` and `docker-compose.yml` are included. You can build and start the app with:
```bash
docker compose up --build
```

The admin access code is displayed in the server logs and rotates every five minutes.
