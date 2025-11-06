# Privacy Policy for SuShe Online - RateYourMusic Integration

**Last Updated: November 6, 2025**

## Overview

SuShe Online - RateYourMusic Integration ("the Extension") is designed with privacy as a core principle. This extension does not collect, store, or transmit any personal data to third parties.

## What Data Does the Extension Access?

### 1. RateYourMusic.com URLs
- **What:** The extension reads album and artist names from RateYourMusic.com page URLs
- **Why:** To identify which album you want to add to your SuShe Online lists
- **Scope:** Only on RateYourMusic.com pages when you explicitly right-click and select an option
- **Storage:** Not stored; processed immediately and discarded

### 2. Your SuShe Online Lists
- **What:** The extension fetches your music lists from your configured SuShe Online instance
- **Why:** To display available lists in the context menu
- **Scope:** Only communicates with the SuShe Online URL you configure
- **Storage:** Cached temporarily in your browser for 5 minutes to improve performance

### 3. Session Cookies
- **What:** The extension uses your existing SuShe Online login session cookies
- **Why:** To authenticate API requests to your SuShe Online instance
- **Scope:** Only for the SuShe Online domain you configure
- **Storage:** Managed by your browser; never accessed or modified by the extension

## What Data Do We Store?

### Locally in Your Browser
The extension stores the following data **only in your browser** using Chrome's storage API:

1. **SuShe Online API URL** - The URL you configure in Options (e.g., https://your-domain.com)
2. **Cached list names** - Your list names, cached for 5 minutes to reduce API calls
3. **Last fetch timestamp** - To manage cache expiration

**This data never leaves your computer** and is stored using Chrome's local storage API.

## What Data Do We NOT Collect?

- ❌ We do NOT track your browsing history
- ❌ We do NOT collect analytics or usage statistics
- ❌ We do NOT store your passwords or login credentials
- ❌ We do NOT share data with third parties
- ❌ We do NOT display advertisements
- ❌ We do NOT sell any data (because we don't collect any!)

## How Does the Extension Communicate?

### Communication Flow
1. **You → Extension:** You right-click on an album
2. **Extension → Your SuShe Online Instance:** The extension sends API requests to YOUR configured SuShe Online URL
3. **Your SuShe Online Instance → External APIs:** Your SuShe instance makes requests to MusicBrainz and Deezer (not the extension directly)

**Important:** The extension ONLY communicates with:
- RateYourMusic.com (to read URLs only, no data sent)
- Your configured SuShe Online instance
- RestCountries.com (to resolve country codes)

The extension does NOT send any data to the extension developers or any analytics services.

## Permissions Explained

The extension requests the following Chrome permissions:

### Required Permissions

| Permission | Why We Need It |
|------------|----------------|
| `contextMenus` | To add "Add to SuShe Online" to your right-click menu |
| `storage` | To save your SuShe Online URL and cache list names locally |
| `cookies` | To use your existing SuShe Online login session |
| `notifications` | To show success/error notifications when adding albums |
| `scripting` | To read album URLs on RateYourMusic.com |

### Host Permissions

| Host | Why We Need It |
|------|----------------|
| `*://*.rateyourmusic.com/*` | To detect albums and read URLs on RateYourMusic |
| `http://localhost:3000/*` | For local development/testing of SuShe Online |
| `https://*/*` | To communicate with your SuShe Online instance (whatever URL you configure) |

## Data Retention

- **Configuration data** (your SuShe Online URL): Stored indefinitely until you uninstall the extension or clear it in Options
- **Cached lists**: Automatically deleted after 5 minutes or when you refresh lists
- **No server-side data**: Nothing is stored on any server controlled by the extension developers

## Your Rights

Since all data is stored locally in your browser, you have complete control:

- **View data:** Open Chrome DevTools → Application → Storage → Extensions
- **Delete data:** Uninstall the extension or clear settings in Options
- **Export data:** Your SuShe Online lists are managed by your SuShe Online instance

## Third-Party Services

The extension facilitates communication with the following services through your SuShe Online instance:

1. **MusicBrainz** - For album metadata (via your SuShe Online proxy)
2. **Deezer** - For album cover art (via your SuShe Online proxy)
3. **RestCountries.com** - For converting country codes to full names

These services have their own privacy policies. The extension does not directly send any personal information to these services.

## Security

- All communication uses HTTPS when possible
- Session cookies are handled securely by Chrome
- No passwords or credentials are stored by the extension
- Open source code available for security review

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date at the top of this document. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Children's Privacy

This extension is not directed at children under 13. We do not knowingly collect any information from children.

## Contact

For questions about this privacy policy or the extension:

- **GitHub Issues:** [Your GitHub Repository]
- **Email:** [Your Contact Email]
- **Website:** [Your SuShe Online Instance or Project Website]

## Open Source

This extension is open source. You can review the complete source code at [GitHub Repository URL] to verify our privacy claims.

---

**In Summary:** This extension is a simple tool to enhance your music cataloging workflow. It doesn't spy on you, doesn't collect data, and doesn't share anything with anyone. It simply helps you add albums from RateYourMusic to your own SuShe Online instance.

