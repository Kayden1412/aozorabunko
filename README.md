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

## URLs

* `/` — fiction, plus `/nonfiction/`, `/poetry/`, `/translations/`
* `/work/?n=2` — one work
* Filters are stored in the query string, e.g. `/?q=cat&genre=fantasy&sort=year-desc`
* Form, genre and tag filters are multi-select; repeat the parameter, e.g.
  `/?form=novel&form=short_story&genre=fantasy`
* Click a filter once to include it and twice to exclude it. Exclusions use a `not_`
  prefix, e.g. `/?form=novel&not_form=short_story`
* Every sort field supports both directions, e.g. `?sort=year-asc`,
  `?sort=length-desc`, or `?sort=kanji-asc`
* Bookmarks use `localStorage` and are shared between the list and work pages.

CBOR shards are gzip-compressed and decoded with `DecompressionStream`
(current Chrome, Edge, Firefox and Safari).
