# SuShe Online

SuShe Online is a Node.js + Express application for managing album lists with a black metal aesthetic.

The project targets **Node.js 22** for both development and production. The included Docker configuration uses Node 22 exclusively.

The `Dockerfile` uses a multi-stage build. The `builder` stage installs all dependencies and compiles assets, then a second `runtime` stage copies the built files into a clean Node 22 image containing only production dependencies.

Docker builds benefit from caching with BuildKit. The `Dockerfile` uses cache mounts to reuse the npm cache between builds. Set `DOCKER_BUILDKIT=1` when running `docker compose build` to enable this optimization.

## Features
- **User accounts** with registration, login and session handling using Passport.js and express-session.
- **Password reset** via email using Nodemailer.
- **Spotify-like interface** for browsing and editing your lists. Drag and drop albums to reorder and import data from MusicBrainz, iTunes and Deezer.
- **Persistent storage** backed by Redis. Existing NeDB data will be migrated automatically on first start.
- **Admin mode** protected by a rotating access code printed to the server console. Admins can view site statistics, manage users and create backups.
- **Custom theme** support allowing each user to pick an accent colour.
- **REST API** endpoints for list management and a proxy for Deezer API requests.
- **Gzip compression** for API and page responses to improve performance.

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
- `DATA_DIR` – directory containing legacy NeDB files for migration (`./data` by default).
- `SENDGRID_API_KEY` – optional API key for sending password reset emails. If omitted, reset links are logged to the console.
- `BASE_URL` – base URL used in password reset emails (`http://localhost:3000` by default).
- `PORT` – server port (defaults to `3000`).
- `REDIS_URL` – Redis connection string (`redis://localhost:6379` by default).

## Running with Docker
A `Dockerfile` and `docker-compose.yml` are included. You can build and start the app with:
```bash
docker compose up --build
```

The compose setup now includes a `redis` service which the app uses for
persistent storage.

Redis may print a warning about `vm.overcommit_memory` when it starts. If you
see this, enable memory overcommit on the host by running:

```bash
sudo sysctl -w vm.overcommit_memory=1
```

You can also persist the setting by adding `vm.overcommit_memory=1` to
`/etc/sysctl.conf` or by using the `sysctls` option in `docker-compose.yml`.

The admin access code is displayed in the server logs and rotates every five minutes.
