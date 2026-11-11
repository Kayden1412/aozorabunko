# Aozora reading guide

A faster static front end for the [Aozora Bunko](https://www.aozora.gr.jp/) catalogue,
built as an alternative to [aozorabunko.netlify.app](https://aozorabunko.netlify.app/).

## Why it's faster

The original site sends each section as one huge HTML document (19–25 MB), with every
work's full summary and analysis rendered into the same response. The browser cannot
show anything until all of it arrives and parses.

This rewrite splits the same content into small, lazy-loaded files:

- The list page is ~73 KB (~14 KB brotli) and includes the first 24 cards, so content
  appears before JavaScript runs.
- Filter data loads after first paint; full-text data loads only when someone searches.
- Search runs in memory against a compact prebuilt index (titles, authors, summaries,
  themes, settings) and starts returning results while the longer analysis text is
  still loading in the background. Filters update instantly with no page reloads or
  server round trips.
- Works are stored in gzipped CBOR shards of 100 entry numbers, so opening one work
  downloads about 43 KB instead of a section-sized page.
- There are no per-work HTML pages, frameworks, web fonts, images or analytics scripts.

The complete deploy is about **20 MB**.

## Build

Requires Python 3.9+ (standard library only).

```bash
python3 build.py
python3 -m http.server 8080 -d dist
```

For a GitHub Pages **project site** (`https://user.github.io/repo/`), build with the
repository name as the base path. The included workflow does this automatically.

```bash
BASE_PATH=/repo/ python3 build.py
```

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Push to `main`; the workflow builds `dist/` and publishes it.

## Improvements over the original

* **Multi-select filters.** Form, genre, sexual content and tag filters take any
  number of values — OR within a group, AND across groups.
* **Exclude filters.** Click a filter once to include it and twice to exclude it.
  Exclusions are stored with a `not_` prefix, e.g. `?not_form=short_story`.
* **Sort every field both ways.** Entry number, author, distinctiveness, length,
  unique kanji and year all sort ascending or descending, e.g. `?sort=length-desc`
  or `?sort=year-asc`.
* **Instant search and filtering.** Everything runs in memory after the small index
  loads — no page reloads or server round trips. Results appear immediately while
  the longer analysis text continues loading.
* **Shareable state.** Search, filters and sorting live in the query string, e.g.
  `/?q=cat&form=novel&form=short_story&not_genre=fantasy&sort=year-desc`.
* **Bookmarks.** Stored in `localStorage` and shared between the list and work viewer.

Routes: `/` (fiction), `/nonfiction/`, `/poetry/`, `/translations/`, and
`/work/?n=2` for a single work.

CBOR shards are gzip-compressed and decoded with `DecompressionStream`
(current Chrome, Edge, Firefox and Safari).
