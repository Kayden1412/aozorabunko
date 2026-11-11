#!/usr/bin/env python3
"""Build the fast Aozora reading guide.

The original exports are 3-25 MB single HTML files that render every work
(and its full analysis) into the page. This script splits them into:
  * a small HTML shell per section, with the first 24 cards server-rendered
  * a compact JSON index per section, loaded after first paint
  * a gzipped CBOR full-text payload per section, loaded only on search
  * gzipped CBOR work shards (100 entry-number range per shard) and one
    static viewer at /work/?n=<number>

Run:  python3 build.py
"""

from __future__ import annotations

import gzip
import hashlib
import html
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

from extract import SECTIONS, parse_article, read_source

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source"

BASE = os.environ.get("BASE_PATH", "/").strip()
BASE = "/" + BASE.strip("/") + "/" if BASE.strip("/") else "/"


def url(path: str = "") -> str:
    """Prefix a site path for root deploys or GitHub Pages project sites."""
    return BASE + path.lstrip("/")
DIST = ROOT / "dist"
SRC_CSS = ROOT / "src" / "style.css"
SRC_JS = ROOT / "src" / "app.js"

PAGE_SIZE = 24
EXCERPT = 190

SECTION_LABELS = {
    "fiction": "Fiction",
    "nonfiction": "Nonfiction",
    "poetry": "Poetry",
    "translations": "Translations",
}

SECTION_FORMS = {
    "fiction": ["short_story", "novel", "novella", "play", "collection", "fragment", "other"],
    "nonfiction": ["essay", "memoir", "criticism", "nonfiction", "collection", "fragment", "other"],
    "poetry": ["poetry", "collection", "fragment"],
    "translations": [
        "short_story", "novel", "novella", "poetry", "play", "essay",
        "memoir", "criticism", "nonfiction", "collection", "fragment", "other",
    ],
}

FORM_LABELS = {
    "short_story": "Short Story",
    "novel": "Novel",
    "novella": "Novella",
    "play": "Play",
    "collection": "Collection",
    "fragment": "Fragment",
    "other": "Other",
    "essay": "Essay",
    "memoir": "Memoir",
    "criticism": "Criticism",
    "nonfiction": "Nonfiction",
    "poetry": "Poetry",
}

GENRE_LABELS = {
    "literary_realism": "Literary Realism",
    "psychological": "Psychological",
    "romance": "Romance",
    "historical": "Historical",
    "mystery": "Mystery",
    "crime": "Crime",
    "horror": "Horror",
    "fantasy": "Fantasy",
    "science_fiction": "Science Fiction",
    "adventure": "Adventure",
    "humour_satire": "Humor / Satire",
    "allegory_fable": "Allegory / Fable",
    "folklore_myth": "Folklore / Myth",
    "children": "Children",
    "nature": "Nature",
    "travel": "Travel",
    "autobiographical": "Autobiographical",
    "social_commentary": "Social Commentary",
    "literary_criticism": "Literary Criticism",
    "philosophy": "Philosophy",
    "other": "Other",
}

SEXUAL_LABELS = {
    "none": "None",
    "references": "References",
    "implied": "Implied",
    "non_graphic": "Non Graphic",
    "explicit": "Explicit",
    "uncertain": "Uncertain",
}

TAG_LABELS = {
    "coercion_assault": "Coercion / Assault",
    "incest": "Incest",
    "minors": "Minors",
    "fetish": "Fetish",
    "voyeurism": "Voyeurism",
    "exhibitionism": "Exhibitionism",
    "sadomasochism": "Sadomasochism",
    "bestiality": "Bestiality",
    "necrophilia": "Necrophilia",
    "commercial_sex": "Commercial Sex",
    "other": "Other",
    "same_sex_relationships": "Same Sex Relationships",
    "gender_variance": "Gender Variance",
    "unconventional_relationships": "Unconventional Relationships",
    "age_disparity": "Age Disparity",
    "infidelity": "Infidelity",
    "unconventional_desire": "Unconventional Desire",
}

SORT_OPTIONS = [
    ("number", "Entry number (ascending)"),
    ("number-desc", "Entry number (descending)"),
    ("author", "Author (A–Z)"),
    ("author-desc", "Author (Z–A)"),
    ("distinctiveness", "Distinctiveness (highest first)"),
    ("distinctiveness-asc", "Distinctiveness (lowest first)"),
    ("length", "Length (longest first)"),
    ("length-asc", "Length (shortest first)"),
    ("kanji", "Unique kanji (most first)"),
    ("kanji-asc", "Unique kanji (fewest first)"),
    ("year-desc", "Year (newest first)"),
    ("year-asc", "Year (oldest first)"),
]

YEAR_SOURCE = {"publication": 0, "death": 1, "unknown": 2}

GENRE_ORDER = list(GENRE_LABELS)
TAG_ORDER = list(TAG_LABELS)
SEXUAL_ORDER = ["none", "references", "implied", "non_graphic", "explicit", "uncertain"]

FAVICON = (
    "data:image/svg+xml,"
    + quote(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="14" fill="#9c3b2b"/>'
        '<path d="M16 17h13c3 0 5 2 5 5v25c0-3-2-5-5-5H16Zm32 0H35v30h13c3 0 5 2 5 5V22c0-3-2-5-5-5Z" fill="#f7f3ea"/>'
        "</svg>"
    )
)

CSS = SRC_CSS.read_text(encoding="utf-8")
CBOR_JS = (ROOT / "src" / "cbor.js").read_text(encoding="utf-8")
APP_JS = CBOR_JS + "\n" + SRC_JS.read_text(encoding="utf-8")
WORK_JS = CBOR_JS + "\n" + (ROOT / "src" / "work.js").read_text(encoding="utf-8")


# --- minimal CBOR encoder (maps, arrays, text, ints, bool, null) -------------

def _cbor_head(major: int, value: int) -> bytes:
    if value < 24:
        return bytes([(major << 5) | value])
    if value < 0x100:
        return bytes([(major << 5) | 24, value])
    if value < 0x10000:
        return bytes([(major << 5) | 25]) + value.to_bytes(2, "big")
    if value < 0x100000000:
        return bytes([(major << 5) | 26]) + value.to_bytes(4, "big")
    return bytes([(major << 5) | 27]) + value.to_bytes(8, "big")


def cbor_encode(value, out: bytearray) -> None:
    if value is None:
        out.append(0xF6)
    elif value is True:
        out.append(0xF5)
    elif value is False:
        out.append(0xF4)
    elif isinstance(value, int):
        if value >= 0:
            out += _cbor_head(0, value)
        else:
            out += _cbor_head(1, -1 - value)
    elif isinstance(value, str):
        data = value.encode("utf-8")
        out += _cbor_head(3, len(data))
        out += data
    elif isinstance(value, (list, tuple)):
        out += _cbor_head(4, len(value))
        for item in value:
            cbor_encode(item, out)
    elif isinstance(value, dict):
        out += _cbor_head(5, len(value))
        for key, item in value.items():
            cbor_encode(key, out)
            cbor_encode(item, out)
    else:
        raise TypeError(f"cannot CBOR-encode {type(value)}")


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def excerpt(text: str, limit: int = EXCERPT) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" ,.;:—–-") + "…"


def year_text(e: dict) -> str:
    if e["year_source"] == "death":
        return f"? (author died {e['year']})"
    if e["year_source"] == "unknown" or e["year"] is None:
        return "?"
    return str(e["year"])


def fmt_int(n: int) -> str:
    return f"{n:,}"


def load_entries() -> dict[str, list[dict]]:
    by_section: dict[str, list[dict]] = {}
    for section in SECTIONS:
        path = SRC / f"{section}.html"
        if not path.exists() and not path.with_name(path.name + ".gz").exists():
            print(f"  skip {path} (missing)", file=sys.stderr)
            continue
        raw = read_source(path)
        found = re.findall(r"<article .*?</article>", raw, re.S)
        entries = [parse_article(a) for a in found]
        for e in entries:
            if not e["section"]:
                e["section"] = section
        entries.sort(key=lambda e: e["n"])
        by_section[section] = entries
        print(f"  {section}: {len(entries):>5} works")
    return by_section


def make_tables(entries: list[dict], section: str):
    authors: list[list[str]] = []
    author_ids: dict[tuple, int] = {}
    forms = list(SECTION_FORMS.get(section, []))
    for e in entries:
        if e["form"] not in forms:
            forms.append(e["form"])
    form_ids = {k: i for i, k in enumerate(forms)}

    genres = list(GENRE_ORDER)
    genre_ids = {k: i for i, k in enumerate(genres)}
    for e in entries:
        for g in e["genres"]:
            if g not in genre_ids:
                genre_ids[g] = len(genres)
                genres.append(g)

    tags = list(TAG_ORDER)
    tag_ids = {k: i for i, k in enumerate(tags)}
    for e in entries:
        for t in e["sexual_tags"]:
            if t not in tag_ids:
                tag_ids[t] = len(tags)
                tags.append(t)

    sexual = list(SEXUAL_ORDER)
    sexual_ids = {k: i for i, k in enumerate(sexual)}

    rows = []
    for e in entries:
        key = (e["author_ja"], e["author_en"], e["author_ja_url"], e["author_en_url"])
        if key not in author_ids:
            author_ids[key] = len(authors)
            authors.append(list(key))
        rows.append(
            [
                e["n"],
                e["title"],
                e["subtitle"],
                author_ids[key],
                e["translator"],
                e["year"],
                YEAR_SOURCE.get(e["year_source"], 2),
                form_ids[e["form"]],
                [genre_ids[g] for g in e["genres"]],
                e["score"],
                sexual_ids.get(e["sexual_level"], sexual_ids["none"]),
                [tag_ids[t] for t in e["sexual_tags"]],
                e["length"],
                e["kanji"],
                excerpt(e["summary"]),
                e["themes"],
            ]
        )

    index = {"a": authors, "f": forms, "g": genres, "x": sexual, "t": tags, "rows": rows}
    return index


def write_data(section: str, entries: list[dict], index: dict) -> tuple[str, str]:
    target = DIST / "data" / section
    target.mkdir(parents=True, exist_ok=True)

    index_bytes = json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    (target / "index.json").write_bytes(index_bytes)
    index_hash = hashlib.sha1(index_bytes).hexdigest()[:10]

    search_rows = [
        [e["n"], e["summary"], e["setting"], e["distinctiveness"], e["sexual_notes"], e["themes"]]
        for e in entries
    ]
    search_raw = bytearray()
    cbor_encode(search_rows, search_raw)
    search_bytes = gzip.compress(bytes(search_raw), compresslevel=9, mtime=0)
    (target / "search.cbor.gz").write_bytes(search_bytes)
    search_hash = hashlib.sha1(search_bytes).hexdigest()[:10]

    print(
        f"  {section}: index {len(index_bytes) / 1e6:.2f} MB, "
        f"search {len(search_bytes) / 1e6:.2f} MB"
    )
    return index_hash, search_hash


def meta_json() -> str:
    payload = {
        "labels": {
            "forms": FORM_LABELS,
            "genres": GENRE_LABELS,
            "sexual": SEXUAL_LABELS,
            "tags": TAG_LABELS,
            "sections": SECTION_LABELS,
        }
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def section_url(section: str) -> str:
    return url("") if section == "fiction" else url(f"{section}/")


def nav_html(current: str) -> str:
    links = []
    for section, label in SECTION_LABELS.items():
        current_attr = ' aria-current="page"' if section == current else ""
        links.append(f'<a href="{section_url(section)}"{current_attr}>{esc(label)}</a>')
    return '<nav class="nav" aria-label="Sections">' + "".join(links) + "</nav>"


def header_html(current: str) -> str:
    return f"""<header class="site-header">
  <div class="wrap header-inner">
    <div class="brand"><h1><a href="{url("")}">青空文庫</a></h1><span class="tagline">Aozora reading guide</span></div>
    {nav_html(current)}
  </div>
</header>"""


def footer_html() -> str:
    return """<footer class="site-footer">
  <div class="wrap">
    <p class="jp">青空文庫 · Aozora Bunko</p>
    <p>An independent, faster reading guide to works in the Aozora Bunko public-domain collection.
    Texts and bibliographic records are hosted by <a href="https://www.aozora.gr.jp/" target="_blank" rel="noopener">aozora.gr.jp</a>.</p>
  </div>
</footer>"""


def head_html(title: str, description: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<link rel="icon" href="{FAVICON}">
<style>{CSS}</style>
</head>"""


def author_html(e: dict) -> str:
    ja = esc(e["author_ja"])
    if e["author_ja_url"]:
        ja = f'<a href="{esc(e["author_ja_url"])}" target="_blank" rel="noopener">{ja}</a>'
    out = ja
    if e["author_en"]:
        en = esc(e["author_en"])
        if e["author_en_url"]:
            en = f'<a href="{esc(e["author_en_url"])}" target="_blank" rel="noopener">{en}</a>'
        out += f' <span class="en">({en})</span>'
    return out


def card_html(e: dict) -> str:
    n = e["n"]
    author = author_html(e)
    author_line = f'<p class="author">{author}</p>' if e["author_ja"] else ""
    subtitle = f'<p class="subtitle">{esc(e["subtitle"])}</p>' if e["subtitle"] else ""
    chips = ""
    if e["genres"]:
        chips = '<ul class="chips">' + "".join(
            f'<li>{esc(GENRE_LABELS.get(g, g))}</li>' for g in e["genres"]
        ) + "</ul>"
    ex = excerpt(e["summary"])
    ex_line = f'<p class="excerpt">{esc(ex)}</p>' if ex else ""
    themes = ""
    if e["themes"]:
        themes = '<p class="themes"><strong>Themes</strong> ' + esc(" · ".join(e["themes"])) + "</p>"
    form = esc(FORM_LABELS.get(e["form"], e["form"]))
    title = esc(e["title"])
    return f"""<article class="card" id="entry-{n}" data-n="{n}">
<div class="card-top"><span class="entry-no">#{n:06d}</span><button class="bm" type="button" data-n="{n}" aria-pressed="false" aria-label="Bookmark {title}" title="Bookmark">☆</button></div>
<h2><a href="{url(f"work/?n={n}")}">{title}</a></h2>
{subtitle}
{author_line}
{chips}
{ex_line}
{themes}
<p class="facts"><span>{esc(year_text(e))}</span><span>{form}</span><span>{fmt_int(e["length"])} chars</span><span title="Unique kanji count">{fmt_int(e["kanji"])} unique kanji</span><span class="score">Distinctive {e["score"]}/5</span></p>
<p class="card-more"><a href="{url(f"work/?n={n}")}">Read the analysis →</a></p>
</article>"""


def filter_options(options: list[tuple[str, str]]) -> str:
    return "".join(f'<option value="{esc(v)}">{esc(l)}</option>' for v, l in options)


def filter_group(name: str, legend: str, options: list[tuple[str, str]]) -> str:
    buttons = "".join(
        f'<button type="button" class="opt" data-group="{name}" data-value="{esc(value)}" '
        f'data-state="off" aria-pressed="false" '
        f'title="Include {esc(text)} — click again to exclude">{esc(text)}</button>'
        for value, text in options
    )
    return (
        f'<fieldset class="filter-group"><legend>{esc(legend)}</legend>'
        f'<div class="options">{buttons}</div></fieldset>'
    )


def section_page(section: str, entries: list[dict], index_hash: str, search_hash: str) -> str:
    label = SECTION_LABELS[section]
    first = entries[:PAGE_SIZE]
    cards = "\n".join(card_html(e) for e in first)
    form_options = [(k, FORM_LABELS.get(k, k)) for k in SECTION_FORMS.get(section, [])]
    genre_options = [(k, GENRE_LABELS.get(k, k)) for k in GENRE_ORDER]
    sexual_options = [(k, SEXUAL_LABELS.get(k, k)) for k in SEXUAL_ORDER if k != "uncertain"]
    tag_options = [("__none", "No tags")] + [(k, TAG_LABELS.get(k, k)) for k in TAG_ORDER]
    score_options = [("0", "Any score")] + [(str(i), f"{i}+ / 5") for i in range(1, 5)] + [("5", "5 / 5")]

    title = f"{label} · Aozora"
    description = (
        f"Browse {len(entries):,} works of Japanese {label.lower()} with English summaries, "
        "themes, settings and content notes."
    )

    return f"""{head_html(title, description)}
<body data-base="{BASE}" data-section="{section}" data-index="{url(f"data/{section}/index.json")}?v={index_hash}" data-search="{url(f"data/{section}/search.cbor.gz")}?v={search_hash}">
<a class="skip" href="#list">Skip to works</a>
{header_html(section)}
<main class="wrap">
  <section class="controls" aria-label="Search and filters">
    <div class="search-row">
      <label class="search">
        <span class="sr-only">Search</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
        <input id="search" type="search" placeholder="Title, author, summary, setting, themes…" autocomplete="off" spellcheck="false">
      </label>
      <button id="bookmarks" class="bm-btn" type="button" aria-pressed="false">★ Bookmarks</button>
    </div>
    <form id="filters">
      <details class="filters">
        <summary>Filters <span id="active-count" class="active-count"></span></summary>
        <div class="filter-grid">
          <p class="filter-hint">Click a filter once to include it, twice to exclude it.</p>
          {filter_group("form", "Form", form_options)}
          {filter_group("genre", "Genre", genre_options)}
          {filter_group("sex", "Sexual content", sexual_options)}
          {filter_group("tag", "Sexual content tag", tag_options)}
          <div class="filter-selects">
            <label class="field">Distinctiveness<select id="distinctiveness">{filter_options(score_options)}</select></label>
            <label class="field">Sort<select id="sort">{filter_options(SORT_OPTIONS)}</select></label>
            <button class="reset" type="reset">Reset</button>
          </div>
        </div>
      </details>
    </form>
  </section>

  <div class="results-bar">
    <p class="count" id="count" aria-live="polite"><strong>{fmt_int(len(entries))}</strong> works</p>
    <p class="status" id="status" aria-live="polite"></p>
  </div>

  <div class="grid" id="list">
{cards}
  </div>
  <p class="empty" id="empty" hidden>No entries match.</p>
  <div id="sentinel" class="sentinel" aria-hidden="true"></div>
  <noscript><p class="noscript">The first {min(PAGE_SIZE, len(entries))} works are listed above. Enable JavaScript for search, filters, bookmarks and the complete list.</p></noscript>
</main>
{footer_html()}
<script type="application/json" id="site-meta">{meta_json()}</script>
<script>{APP_JS}</script>
</body>
</html>
"""


def work_page(works_version: str) -> str:
    return f"""{head_html("Work · Aozora", "Read a work from the Aozora Bunko collection.")}
<body data-base="{BASE}" data-works="{url("data/works/")}" data-v="{works_version}">
<a class="skip" href="#work">Skip to work</a>
{header_html("")}
<main class="wrap">
  <div id="work"><p class="loading">Loading work…</p></div>
  <noscript><p class="noscript">This viewer needs JavaScript. The work text is also available at <a href="https://www.aozora.gr.jp/" target="_blank" rel="noopener">aozora.gr.jp</a>.</p></noscript>
</main>
{footer_html()}
<script type="application/json" id="site-meta">{meta_json()}</script>
<script>{WORK_JS}</script>
</body>
</html>
"""


def not_found_page() -> str:
    return f"""{head_html("Page not found · Aozora", "The requested page could not be found.")}
<body>
{header_html("")}
<main class="wrap">
  <article class="entry">
    <h1>Page not found</h1>
    <p class="prose">That work or page does not exist. Try the <a href="{url("")}">fiction index</a>.</p>
  </article>
</main>
{footer_html()}
</body>
</html>
"""


def work_row(e: dict) -> list:
    return [
        e["n"], e["section"], e["title"], e["subtitle"],
        e["author_ja"], e["author_en"], e["author_ja_url"], e["author_en_url"],
        e["translator"], e["year"], e["year_source"], e["form"], e["genres"],
        e["score"], e["sexual_level"], e["sexual_tags"], e["length"], e["kanji"],
        e["summary"], e["setting"], e["themes"], e["distinctiveness"],
        e["sexual_notes"], e["card_url"], e["read_url"],
    ]


def main() -> None:
    if not SRC.exists():
        sys.exit("source/ directory is missing")

    print("Parsing source exports…")
    by_section = load_entries()
    if not by_section:
        sys.exit("no entries found in source/")

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    print("Writing list/search data…")
    hashes: dict[str, tuple[str, str]] = {}
    for section, entries in by_section.items():
        index = make_tables(entries, section)
        hashes[section] = write_data(section, entries, index)

    print("Writing CBOR work shards…")
    all_entries = sorted((e for entries in by_section.values() for e in entries), key=lambda e: e["n"])
    shards: dict[int, list] = {}
    for e in all_entries:
        shards.setdefault(e["n"] // 100, []).append(work_row(e))

    works_dir = DIST / "data" / "works"
    works_dir.mkdir(parents=True)
    digest = hashlib.sha1()
    shard_bytes = 0
    for shard_number in sorted(shards):
        out = bytearray()
        cbor_encode(shards[shard_number], out)
        packed = gzip.compress(bytes(out), compresslevel=9, mtime=0)
        (works_dir / f"{shard_number}.cbor.gz").write_bytes(packed)
        digest.update(packed)
        shard_bytes += len(packed)
    works_version = digest.hexdigest()[:10]
    print(f"  {len(shards)} gzipped shards, {shard_bytes / 1e6:.2f} MB")

    print("Writing section pages…")
    for section, entries in by_section.items():
        page = section_page(section, entries, hashes[section][0], hashes[section][1])
        target = DIST if section == "fiction" else DIST / section
        target.mkdir(parents=True, exist_ok=True)
        (target / "index.html").write_text(page, encoding="utf-8")
        print(f"  {section}: /{'' if section == 'fiction' else section + '/'}")

    (DIST / "work").mkdir()
    (DIST / "work" / "index.html").write_text(work_page(works_version), encoding="utf-8")

    (DIST / "404.html").write_text(not_found_page(), encoding="utf-8")
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")

    total_html = sum(len(p.read_bytes()) for p in DIST.rglob("*.html"))
    total = sum(len(p.read_bytes()) for p in DIST.rglob("*") if p.is_file())
    print(f"Done: {len(all_entries):,} works in {len(shards)} shards")
    print(f"  HTML: {total_html / 1e6:.2f} MB · dist total: {total / 1e6:.2f} MB")
    print(f"Output: {DIST}")


if __name__ == "__main__":
    main()
