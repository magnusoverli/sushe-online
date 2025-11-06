# SuShe Online - RateYourMusic Integration

Chrome extension that allows you to add albums from RateYourMusic.com directly to your SuShe Online lists using MusicBrainz lookup.

## 🚀 Publishing to Chrome Web Store

**Ready to publish?** See these guides:

- **[SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md)** - Quick checklist of what you need to do
- **[CHROME_STORE_SUBMISSION.md](CHROME_STORE_SUBMISSION.md)** - Complete step-by-step guide
- **[STORE_LISTING.md](STORE_LISTING.md)** - Store description & marketing copy
- **[PRIVACY_POLICY.md](PRIVACY_POLICY.md)** - Privacy policy for the store listing

**Quick package for submission:**

```bash
./package-for-store.sh
```

This creates `sushe-online-extension.zip` ready to upload to the Chrome Web Store.

## Features

- 🎸 Right-click on album images/links on RateYourMusic to add them to your lists
- 📋 Dynamic context menu showing all your SuShe Online lists
- 🔍 **Uses MusicBrainz search** - No scraping of RateYourMusic data
- 🎨 **Full metadata** - Cover art, release dates, MusicBrainz IDs, artist country
- 🔔 Browser notifications for progress and completion
- 🚫 Duplicate detection - won't add the same album twice
- ⚡ Follows the same flow as manually adding albums in SuShe Online

## How It Works

1. **Extract artist & album name** from RateYourMusic URL (e.g., `/release/album/metallica/ride_the_lightning/`)
2. **Search MusicBrainz** via SuShe Online's proxy API
3. **Fetch cover art** from Deezer (via proxy)
4. **Add to list** with full metadata (same as manual addition)

**No RateYourMusic scraping!** The extension only reads the URL to get artist/album names, then uses your SuShe Online instance's APIs.

## Installation (Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked"
4. Select the `/browser-extension` directory from this project
5. Configure your SuShe Online URL in Options (right-click extension icon → Options)

## Usage

1. **Login to SuShe Online** - Open your instance and login
2. **Browse RateYourMusic** - Go to https://rateyourmusic.com
3. **Right-click on album images** - You'll see "Add to SuShe Online" with your lists as submenus
4. **Select a list** - Click on the list you want to add the album to
5. **Wait for completion** - Extension searches MusicBrainz, fetches cover art, and adds album
6. **Done!** - You'll get a notification confirming the album was added

## Configuration

### Set Your SuShe Online URL

1. Right-click the extension icon in Chrome toolbar
2. Select **"Options"**
3. Enter your SuShe Online URL:
   - Local dev: `http://localhost:3000`
   - Production: `https://your-domain.com`
4. Click **"Save Settings"**
5. Optional: Click **"Test Connection"** to verify

The extension will remember your URL and use it for all API calls.

## What Data Is Extracted?

From **RateYourMusic URL only**:

- Artist name (from URL path)
- Album name (from URL path)

From **MusicBrainz** (via SuShe Online):

- MusicBrainz release group ID
- Release date
- Artist country

From **Deezer** (via SuShe Online):

- Album cover art (converted to base64)

**Result:** Albums have the same data quality as manually added albums!

## Troubleshooting

### Context menu not appearing

- Make sure you're logged into SuShe Online
- Check API URL in Options
- Try refreshing RateYourMusic page

### "Album not found in MusicBrainz"

- The album might not be in MusicBrainz database
- Try adding it manually in SuShe Online
- Check if artist/album name in RYM URL is correct

### "Not logged in to SuShe Online"

- Open your SuShe instance and login
- Click extension icon and "Refresh Lists"

## Privacy & RateYourMusic ToS

This extension is **RateYourMusic-friendly**:

- ✅ Only reads URL path (publicly visible)
- ✅ No scraping of page content
- ✅ No automated requests to RateYourMusic servers
- ✅ Uses MusicBrainz as authoritative source

All album data comes from MusicBrainz and Deezer, not from RateYourMusic.

## Development

Files:

- `manifest.json` - Extension configuration
- `background.js` - Service worker (context menus, MusicBrainz search, API calls)
- `content-script.js` - Extracts artist/album from URL
- `options.html` / `options.js` - Settings page
- `popup.html` / `popup.js` - Extension popup UI

## Technical Details

### API Flow

```
1. User right-clicks album on RYM
2. Extract: artist="Metallica", album="Ride the Lightning" (from URL)
3. Search MusicBrainz via /api/proxy/musicbrainz
4. Get cover art from Deezer via /api/proxy/deezer
5. Convert image to base64 via /api/proxy/image
6. Add to list via POST /api/lists/:name
```

### Respects Rate Limits

- Uses SuShe Online's MusicBrainz queue (1 req/sec)
- Proxies all external requests through your server
- No direct calls to RateYourMusic, MusicBrainz, or Deezer

## Future Enhancements

- [ ] Show preview of matched album before adding
- [ ] Bulk import from RYM lists
- [ ] Support for other music sites
- [ ] Visual indicator for albums already in SuShe
