# SuShe Online

SuShe Online is a Node.js + Express application for managing album lists with a black metal aesthetic.

The project targets **Node.js 22** for both development and production. The included Docker configuration uses Node 22 exclusively.

The `Dockerfile` uses a multi-stage build. The `builder` stage installs all dependencies and compiles assets, then a second `runtime` stage copies the built files into a clean Node 22 image containing only production dependencies.

Docker builds benefit from caching with BuildKit. The `Dockerfile` uses cache mounts to reuse the npm cache between builds. Set `DOCKER_BUILDKIT=1` when running `docker compose build` to enable this optimization.

## Features
- **User accounts** with registration, login and session handling using Passport.js and express-session.
- **Password reset** via email using Nodemailer.
- **Spotify-like interface** for browsing and editing your lists. Drag and drop albums to reorder and import data from MusicBrainz, iTunes and Deezer.
- **Persistent storage** using NeDB databases stored locally in the `data` directory.
- **Admin mode** protected by a rotating access code printed to the server console. Admins can view site statistics, manage users and create backups.
- **Custom theme** support allowing each user to pick an accent colour.
- **REST API** endpoints for list management and a proxy for Deezer API requests.
- **Gzip compression** for API and page responses to improve performance.

## Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server in development mode with automatic reload and CSS watch:
   ```bash
   npm run dev
   ```
3. Alternatively, run `npm start` to build the CSS once and launch the server without watchers.

## Environment variables
- `SESSION_SECRET` – session encryption secret.
- `DATA_DIR` – directory where NeDB stores databases (`./data` by default).
- `SENDGRID_API_KEY` – optional API key for sending password reset emails. If omitted, reset links are logged to the console.
- `BASE_URL` – base URL used in password reset emails (`http://localhost:3000` by default).
- `PORT` – server port (defaults to `3000`).
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` – credentials for Spotify OAuth.
- `SPOTIFY_REDIRECT_URI` – callback URL registered with Spotify.
- `TIDAL_CLIENT_ID` – client ID for Tidal OAuth.
- `TIDAL_REDIRECT_URI` – callback URL registered with Tidal.
  The client ID is also sent as the `X-Tidal-Token` header on API
  requests.
- The TIDAL integration is authorized for the following scopes:
  `user.read`, `collection.read`, `search.read`, `playlists.write`,
  `playlists.read`, `entitlements.read`, `collection.write`, `playback`,
  `recommendations.read`, `search.write`. Offline access is not granted, so
  tokens expire and must be reauthorized when they expire.

The `/api/tidal/album` endpoint uses TIDAL's v2 `searchResults` API to look up
an album ID. This works with the `search.read` scope and does not require the
`r_usr` scope that older search endpoints need. The user's profile is fetched
after OAuth to store their `countryCode`, which is then used for all searches
instead of the hard-coded `US` locale.
Note that apostrophes must be percent-encoded in the query string; the server
manually replaces `'` with `%27` after `encodeURIComponent` so the Tidal API
parses the request correctly.

When running with Docker Compose, place these variables in a `.env` file or
export them so they are available to the container.

## Running with Docker
A `Dockerfile` and `docker-compose.yml` are included. You can build and start the app with:
```bash
docker compose up --build
```

The admin access code is displayed in the server logs and rotates every five minutes.
