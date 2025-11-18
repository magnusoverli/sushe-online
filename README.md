# 🤘 SuShe Online

**Your personal music collection manager with a dark aesthetic.**

SuShe Online is a web application for creating, organizing, and managing your album lists. Discover albums, track your collection, create playlists, and sync them to Spotify or Tidal. Built for music enthusiasts who want to catalog their journey through music.

[![Live Demo](https://img.shields.io/badge/demo-sushe.overli.dev-red)](https://sushe.overli.dev)

---

## ✨ Features

### 🎵 Music Collection Management

- **Create unlimited lists** - Organize albums by year, genre, mood, or any way you like
- **Rich album metadata** - Automatically fetch cover art, release dates, and artist info from MusicBrainz and Deezer
- **Drag & drop** - Reorder albums with intuitive drag-and-drop interface
- **Track selection** - Pick your favorite tracks from each album for playlist creation
- **Comments & ratings** - Add personal notes and genres to each album
- **Duplicate detection** - Prevents adding the same album twice

### 🎧 Music Service Integration

- **Spotify & Tidal sync** - Create and update playlists directly in your music streaming service
- **Smart track matching** - Automatically finds tracks across services
- **Real-time progress** - See playlists being built track-by-track
- **Service selection** - Choose your preferred platform or switch per-playlist

### 🔌 Browser Extension

- **Chrome extension** - Add albums from RateYourMusic.com with one right-click
- **Seamless integration** - Albums added via extension include full metadata
- **Context menu** - Right-click any album on RateYourMusic to add it to your lists
- **[Get the extension →](browser-extension/)**

### 🎨 Personalization

- **Custom themes** - Choose your accent color
- **Dark mode** - Spotify-inspired interface with a metal aesthetic
- **Responsive design** - Works on desktop, tablet, and mobile

### 👥 Multi-User & Social

- **User accounts** - Secure registration and login
- **Password reset** - Email-based password recovery
- **Shared metadata** - Album details added by one user benefit everyone
- **Admin dashboard** - Site statistics, user management, and backups

### 🔒 Security & Performance

- **Production-grade security** - Rate limiting, CSRF protection, CSP headers
- **PostgreSQL database** - Reliable persistent storage
- **Session management** - Secure authentication with Passport.js
- **Gzip compression** - Fast page loads and API responses
- **Docker ready** - Easy deployment with included Docker configuration

---

## 🚀 Quick Start

### For Users

**Visit the live instance:** [sushe.overli.dev](https://sushe.overli.dev)

1. **Create an account** - Quick registration, no email verification needed
2. **Create your first list** - Click "New List" and give it a name
3. **Add albums** - Search by artist or album name to add from MusicBrainz
4. **Install the browser extension** - Add albums directly from RateYourMusic (optional)
5. **Connect a music service** - Link Spotify or Tidal to create playlists (optional)

### For Self-Hosting

**Requirements:**

- Docker & Docker Compose (recommended)
- OR Node.js 22+ and PostgreSQL 16

**Quick Deploy with Docker:**

```bash
# Clone the repository
git clone https://github.com/magnusoverli/sushe-online.git
cd sushe-online

# Create environment file
cp .env.example .env
# Edit .env with your settings (SESSION_SECRET, etc.)

# Start the application
docker compose up --build

# Visit http://localhost:3000
```

The app will be available at `http://localhost:3000`. The admin code appears in the console logs.

---

## 🛠️ Configuration

### Essential Environment Variables

```bash
# Required
SESSION_SECRET=your-secret-key-here
DATABASE_URL=postgresql://user:pass@localhost/sushe

# Optional but recommended
SENDGRID_API_KEY=your-sendgrid-key  # For password reset emails
BASE_URL=https://your-domain.com    # For email links
```

### Music Service Integration (Optional)

**Spotify:**

```bash
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=https://your-domain.com/auth/spotify/callback
```

**Tidal:**

```bash
TIDAL_CLIENT_ID=your-client-id
TIDAL_REDIRECT_URI=https://your-domain.com/auth/tidal/callback
```

### Security & Rate Limiting

Rate limiting is **enabled by default** with production-ready settings:

```bash
RATE_LIMIT_LOGIN_MAX=5          # Max login attempts per 15 min
RATE_LIMIT_REGISTER_MAX=3       # Max registrations per hour
RATE_LIMIT_API_MAX=100          # Max API calls per 15 min
DISABLE_RATE_LIMITING=false     # Set to true only for development
```

Security headers (CSP, HSTS, etc.) are automatically configured. For HTTPS deployments:

```bash
ENABLE_HSTS=true                # Enable HSTS when behind SSL
NODE_ENV=production             # Enables additional security features
```

See the [Environment Variables](#environment-variables-reference) section below for complete configuration options.

---

## 🎸 Usage Guide

### Creating Lists

1. Click "**New List**" button
2. Enter a name (e.g., "2025 Favorites", "Black Metal Classics")
3. Start adding albums!

### Adding Albums

**Method 1: Search & Add**

1. Type artist or album name in the search box
2. Select from MusicBrainz results
3. Album is added with cover art, release date, and metadata

**Method 2: Browser Extension (Chrome)**

1. Install the [SuShe Online Chrome extension](browser-extension/)
2. Browse RateYourMusic.com
3. Right-click any album → "Add to SuShe Online" → Select list

### Editing Albums

- Click an album to expand details
- Add/edit genres, comments, and metadata
- Select favorite tracks for playlist creation
- Drag the handle to reorder albums

### Creating Playlists

1. **Connect a music service** (Settings → Connect Spotify/Tidal)
2. **Select tracks** from albums in your list (click album → check tracks)
3. **Right-click the list** → "Update Playlist"
4. **Choose service** (if no default set)
5. **Watch progress** as playlist is created
6. **Done!** Playlist appears in your Spotify/Tidal account

### Admin Features

Access admin mode by clicking the 🤘 icon and entering the code from server logs:

- **View statistics** - Users, albums, lists, activity
- **Manage users** - View accounts, activity, delete if needed
- **Create backups** - Download database dumps
- **Restore backups** - Upload and restore previous backups
- **Monitor system** - Session info, cache stats

---

## 🧑‍💻 Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Start development server (with auto-reload and CSS/JS watch)
npm run dev

# Build CSS and JS manually
npm run build

# Run tests
npm test

# Run end-to-end tests
npm run test:e2e

# Code quality
npm run lint
npm run format
```

### Development Tools

- **Auto-reload** - Server restarts on code changes (via nodemon)
- **CSS/JS watch** - Assets rebuild automatically
- **Hot module replacement** - Fast development iterations
- **Test suite** - Security, auth, and core functionality tests
- **Playwright E2E** - Browser-based integration tests
- **ESLint & Prettier** - Code quality and formatting

### Project Structure

```
sushe-online/
├── routes/           # Express route handlers
│   ├── auth.js       # Authentication (login, register, password reset)
│   ├── api.js        # REST API endpoints
│   └── admin.js      # Admin dashboard
├── db/               # Database layer
│   ├── postgres.js   # PostgreSQL client
│   └── migrations/   # Database schema migrations
├── middleware/       # Express middleware
│   ├── rate-limit.js # Rate limiting
│   └── error-handler.js
├── views/            # EJS templates
├── src/              # Frontend source
│   ├── js/           # JavaScript (bundled with Rollup)
│   └── styles/       # Tailwind CSS
├── public/           # Static assets (built)
├── browser-extension/ # Chrome extension for RateYourMusic
└── test/             # Test suite
```

### Running Tests

```bash
# Core tests (~40 tests, 30 seconds)
npm test

# End-to-end browser tests
npm run test:e2e

# Test with coverage report
npm run test:coverage

# Watch mode
npm run test:watch
```

Tests cover security middleware, session management, authentication, and critical paths.

---

## 🐳 Docker Deployment

### Docker Compose (Recommended)

The included `docker-compose.yml` sets up the app and PostgreSQL database:

```bash
# Build and start
docker compose up --build

# Run in background
docker compose up -d

# View logs
docker compose logs -f app

# Stop
docker compose down
```

### Environment Variables in Docker

Create a `.env` file in the project root:

```bash
SESSION_SECRET=your-secret-here
SENDGRID_API_KEY=your-key-here
BASE_URL=https://your-domain.com
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=https://your-domain.com/auth/spotify/callback
```

Docker Compose automatically loads this file.

### Updating Your Deployment

The Docker image is automatically built and published to GitHub Container Registry on every push to `main`. To update your deployment:

**Quick Update:**

```bash
./update.sh
```

**Manual Update:**

```bash
# Pull latest image
docker compose pull app

# Recreate app container with new image
docker compose up -d app

# View logs
docker compose logs -f app
```

**Automated Updates (optional):**

Use [Watchtower](https://containrrr.github.io/watchtower/) to automatically update:

```bash
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  sushe-online \
  --cleanup \
  --interval 3600  # Check every hour
```

### Production Deployment

1. **Use a reverse proxy** (nginx, Caddy, Traefik) for SSL termination
2. **Set `ENABLE_HSTS=true`** when behind HTTPS
3. **Configure `BASE_URL`** to your domain
4. **Set strong `SESSION_SECRET`**
5. **Configure email** (SENDGRID_API_KEY) for password resets
6. **Regular backups** - Use admin dashboard or pg_dump
7. **Monitor logs** - Check Docker logs or application logs
8. **Keep updated** - Run `./update.sh` or use Watchtower

---

## 🔐 Security

SuShe Online implements production-grade security:

- ✅ **Rate limiting** - Prevents brute force attacks on auth endpoints
- ✅ **CSRF protection** - Protects against cross-site request forgery
- ✅ **XSS prevention** - Content Security Policy headers
- ✅ **SQL injection protection** - Parameterized queries
- ✅ **Secure sessions** - HTTPOnly cookies with encryption
- ✅ **Password hashing** - bcrypt with proper salting
- ✅ **Security headers** - HSTS, CSP, X-Frame-Options, etc.
- ✅ **Input validation** - Server-side validation on all inputs

### Whitelisted External Services

The Content Security Policy allows connections to:

- **Music services**: Spotify, Tidal, Deezer, MusicBrainz
- **Assets**: Google Fonts, Wikimedia Commons
- **APIs**: RestCountries

All security features work out-of-the-box with no configuration required.

---

## 📦 Browser Extension

The **SuShe Online Chrome Extension** lets you add albums from RateYourMusic.com with one click.

### Features

- Right-click context menu on RateYourMusic albums
- Add albums directly to any of your SuShe Online lists
- Automatic MusicBrainz metadata lookup
- Cover art and release date included
- Duplicate detection

### Installation

- **Chrome Web Store**: Coming soon! (submitted for review)
- **Manual install**: See [browser-extension/README.md](browser-extension/README.md)

### Usage

1. Install the extension
2. Configure your SuShe Online URL (extension options)
3. Browse RateYourMusic.com
4. Right-click any album → "Add to SuShe Online" → Select list

---

## 🤝 Contributing

Contributions are welcome! This is a personal project, but improvements are appreciated.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with a descriptive message
6. Push and open a Pull Request

### Code Style

- Use Prettier for formatting (`npm run format`)
- Follow ESLint rules (`npm run lint`)
- Write tests for new features
- Keep the dark aesthetic 🤘

---

## 📝 Environment Variables Reference

<details>
<summary><strong>Click to expand complete configuration reference</strong></summary>

### Core Settings

| Variable         | Default                 | Description                     |
| ---------------- | ----------------------- | ------------------------------- |
| `PORT`           | `3000`                  | Server port                     |
| `SESSION_SECRET` | Required                | Session encryption key          |
| `DATABASE_URL`   | Required                | PostgreSQL connection string    |
| `DATA_DIR`       | `./data`                | Session file storage directory  |
| `BASE_URL`       | `http://localhost:3000` | Base URL for emails and links   |
| `LOG_SQL`        | `false`                 | Log all SQL queries (debugging) |

### Email (Password Reset)

| Variable           | Default  | Description                 |
| ------------------ | -------- | --------------------------- |
| `SENDGRID_API_KEY` | Optional | SendGrid API key for emails |

### Music Services

| Variable                | Required | Description             |
| ----------------------- | -------- | ----------------------- |
| `SPOTIFY_CLIENT_ID`     | Optional | Spotify OAuth client ID |
| `SPOTIFY_CLIENT_SECRET` | Optional | Spotify OAuth secret    |
| `SPOTIFY_REDIRECT_URI`  | Optional | OAuth callback URL      |
| `TIDAL_CLIENT_ID`       | Optional | Tidal OAuth client ID   |
| `TIDAL_REDIRECT_URI`    | Optional | OAuth callback URL      |

### Security & Rate Limiting

| Variable                  | Default       | Description                       |
| ------------------------- | ------------- | --------------------------------- |
| `DISABLE_RATE_LIMITING`   | `false`       | Disable rate limiting (dev only)  |
| `RATE_LIMIT_LOGIN_MAX`    | `5`           | Max login attempts per 15 min     |
| `RATE_LIMIT_REGISTER_MAX` | `3`           | Max registrations per hour        |
| `RATE_LIMIT_FORGOT_MAX`   | `3`           | Max password reset requests/hour  |
| `RATE_LIMIT_RESET_MAX`    | `5`           | Max password resets per hour      |
| `RATE_LIMIT_SETTINGS_MAX` | `10`          | Max settings changes per hour     |
| `RATE_LIMIT_API_MAX`      | `100`         | Max API calls per 15 min          |
| `ENABLE_HSTS`             | `false`       | Enable HSTS (production w/ HTTPS) |
| `CSP_REPORT_ONLY`         | `false`       | CSP report-only mode              |
| `NODE_ENV`                | `development` | Node environment                  |

### Performance & Caching

| Variable        | Default   | Description                             |
| --------------- | --------- | --------------------------------------- |
| `ASSET_VERSION` | timestamp | Cache-busting version for static assets |

### Database Tools

| Variable     | Default      | Description                |
| ------------ | ------------ | -------------------------- |
| `PG_DUMP`    | `pg_dump`    | Path to pg_dump utility    |
| `PG_RESTORE` | `pg_restore` | Path to pg_restore utility |

</details>

---

## 📄 License

This project is open source. Feel free to use, modify, and distribute.

---

## 🎸 Credits

Built with:

- **Node.js** & **Express** - Backend framework
- **PostgreSQL** - Database
- **Tailwind CSS** - Styling
- **MusicBrainz** - Music metadata
- **Deezer** - Album cover art
- **Passport.js** - Authentication
- **Spotify & Tidal APIs** - Playlist integration

Made with ❤️ for music lovers who want to catalog their musical journey.

---

## 🔗 Links

- **Live Demo**: [sushe.overli.dev](https://sushe.overli.dev)
- **GitHub**: [magnusoverli/sushe-online](https://github.com/magnusoverli/sushe-online)
- **Browser Extension**: [Chrome Web Store](https://chrome.google.com/webstore) (coming soon!)

---

**Happy cataloging! 🤘**
