# Historical List Import Format

Administrators can import historical lists from **Settings > Admin > Historical List Import**. One JSON file represents one list. Multiple files can be selected and previewed together.

The administrator selects the registered user who owns each list. A file must not contain a user ID, username, or email address.

## Required Structure

Files must be UTF-8 JSON and follow version 1 of the format:

```json
{
  "version": 1,
  "list": {
    "name": "Best Albums of 2018",
    "year": 2018
  },
  "albums": [
    {
      "position": 1,
      "artist": "Artist Name",
      "album": "Album Title"
    },
    {
      "position": 2,
      "artist": "Another Artist",
      "album": "Another Album",
      "comments": "Optional public comment",
      "comments_2": "Optional secondary comment",
      "primary_track": "Optional primary track",
      "secondary_track": "Optional secondary track",
      "release_date": "2018-04-13",
      "country": "Norway",
      "genre_1": "Primary genre",
      "genre_2": "Secondary genre",
      "is_disqualified": true,
      "disqualification_reason": "Released before the eligible year"
    }
  ]
}
```

The machine-readable schema is [`historical-list-import.schema.json`](historical-list-import.schema.json).

## Rules

- `version` must be the number `1`.
- `list.name` is required and may contain at most 200 characters.
- `list.year` is required and must be an integer from 1000 through 9999.
- `albums` must contain between 1 and 1000 entries.
- `position` must start at 1 and remain consecutive without duplicates or gaps.
- `artist` and `album` are required strings of at most 500 characters.
- Comments and track selections are optional and belong only to this list entry.
- `is_disqualified: true` keeps the album at its physical rank but gives it zero points and excludes it from aggregate voting.
- `disqualification_reason` is optional, may contain at most 1000 characters, and requires `is_disqualified: true`.
- `release_date`, `country`, `genre_1`, and `genre_2` are optional canonical metadata. Release dates use `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.
- Unknown fields are rejected so misspelled fields do not disappear silently.
- Two entries that normalize to the same artist and album are rejected rather than silently changing the ranking.
- The list is created as a non-main list. Importing it does not automatically change historical aggregate lists.
- A user cannot receive two lists with the same name in the same year.

## Canonical Album References

Do not include `album_id`, list item `_id`, provider IDs, or database IDs in newly generated files. IDs from spreadsheets, another Sushe installation, Spotify, MusicBrainz, or Rate Your Music are not canonical references in the target database.

During preview, the server normalizes each `artist` and `album` pair and resolves it against the target installation:

- A single existing match uses that album's local canonical ID and display identity.
- No match creates a new canonical album when the list is committed.
- Multiple existing matches are reported as ambiguous and block the import.
- Source IDs found in legacy files are ignored and shown as a warning.

Historical list import is membership-only. It cannot overwrite globally shared album covers, genres, summaries, release metadata, taxonomy, availability, or service mappings.

Supplied release dates, country, and genres are stored for new canonical albums. For an existing canonical album, a supplied value fills an empty field but never overwrites a populated field. Preview warnings identify both planned enrichments and values that will be ignored because canonical metadata already exists.

## Creating Files With an LLM or Agent

Give the agent this document, the JSON schema, and the source CSV or Excel file. A useful instruction is:

> Convert this source into one UTF-8 JSON file per list. Follow historical-list-import.schema.json exactly. Preserve ranking using consecutive position values beginning at 1. Put performer names in artist and release titles in album. Include year in list.year. Do not invent missing albums, users, IDs, genres, summaries, or metadata. Report uncertain rows instead of guessing.

Validate generated files against the JSON schema before uploading. The application performs another authoritative validation during preview.
