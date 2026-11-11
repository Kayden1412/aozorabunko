#!/usr/bin/env python3
"""Extract structured entries from the original single-page Aozora exports."""

import gzip
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source"
OUT = ROOT / "data"
SECTIONS = ["fiction", "nonfiction", "poetry", "translations"]

def read_source(path: Path) -> str:
    """Read a source export, preferring the gzipped copy."""
    gz = path.with_name(path.name + ".gz")
    if gz.exists():
        return gzip.decompress(gz.read_bytes()).decode("utf-8")
    return path.read_text(encoding="utf-8")


TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def text(fragment: str) -> str:
    """Strip tags, unescape entities and normalise whitespace."""
    fragment = re.sub(r"<br\s*/?>", " ", fragment)
    fragment = TAG_RE.sub("", fragment)
    fragment = html.unescape(fragment)
    return WS_RE.sub(" ", fragment).strip()


def paragraphs(fragment: str) -> list[str]:
    parts = re.findall(r"<p[^>]*>(.*?)</p>", fragment, re.S)
    if not parts:
        parts = [fragment]
    return [t for t in (text(p) for p in parts) if t]


def items(fragment: str) -> list[str]:
    return [t for t in (text(li) for li in re.findall(r"<li[^>]*>(.*?)</li>", fragment, re.S)) if t]


def parse_article(raw: str) -> dict:
    open_tag = re.match(r"<article ([^>]*)>", raw).group(1)

    def attr(name):
        m = re.search(rf'\b{name}="([^"]*)"', open_tag)
        return html.unescape(m.group(1)) if m else ""

    number = int(attr("data-number"))
    body = raw[raw.index(">") + 1 :]

    title_m = re.search(r'<div class="entry-heading">.*?<h2>(.*?)</h2>', body, re.S)
    title = text(title_m.group(1)) if title_m else ""

    sub_m = re.search(r'<p class="subtitle">(.*?)</p>', body, re.S)
    subtitle = text(sub_m.group(1)) if sub_m else ""

    meta = {}
    for dt, dd in re.findall(r"<dt>(.*?)</dt><dd>(.*?)</dd>", body, re.S):
        meta[text(dt)] = dd

    author_dd = meta.get("Author", "")
    author_ja = author_en = author_ja_url = author_en_url = ""
    for url, label in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', author_dd, re.S):
        label = text(label)
        if "en.wikipedia.org" in url:
            author_en, author_en_url = label, html.unescape(url)
        elif "ja.wikipedia.org" in url:
            author_ja, author_ja_url = label, html.unescape(url)
    if not author_ja:
        author_ja = text(author_dd)
    if not author_en:
        author_en = ""

    translator = text(meta.get("Translator", ""))

    summary_m = re.search(r'<p class="summary">(.*?)</p>', body, re.S)
    summary = text(summary_m.group(1)) if summary_m else ""

    setting: list[str] = []
    themes: list[str] = []
    distinctiveness = ""
    sexual_notes = ""
    for dt, dd in re.findall(r"<div><dt>(.*?)</dt><dd>(.*?)</dd></div>", body, re.S):
        key = text(re.sub(r"<span[^>]*>.*?</span>", "", dt, flags=re.S)).strip()
        if key == "Setting":
            setting = paragraphs(dd)
        elif key == "Themes":
            themes = items(dd)
        elif key == "Distinctiveness":
            distinctiveness = text(re.sub(r'<span class="score">.*?</span>', "", dd, flags=re.S))
        elif key == "Sexual content":
            sexual_notes = text(re.sub(r'<ul class="tags">.*?</ul>', "", dd, flags=re.S))

    links = re.findall(r'<div class="source-links">(.*?)</div>', body, re.S)
    card_url = read_url = ""
    if links:
        hrefs = re.findall(r'href="([^"]+)"', links[0])
        if hrefs:
            card_url = html.unescape(hrefs[0])
        if len(hrefs) > 1:
            read_url = html.unescape(hrefs[1])

    try:
        genres = json.loads(attr("data-genres"))
    except json.JSONDecodeError:
        genres = []
    try:
        sexual_tags = json.loads(attr("data-sexual-tags"))
    except json.JSONDecodeError:
        sexual_tags = []

    return {
        "n": number,
        "section": attr("data-section"),
        "title": title,
        "subtitle": subtitle,
        "author_ja": author_ja,
        "author_en": author_en,
        "author_ja_url": author_ja_url,
        "author_en_url": author_en_url,
        "translator": translator,
        "year": int(attr("data-year")) if attr("data-year") else None,
        "year_source": attr("data-year-source"),
        "form": attr("data-form"),
        "genres": genres,
        "score": int(attr("data-score")) if attr("data-score") else 0,
        "sexual_level": attr("data-sexual-level"),
        "sexual_tags": sexual_tags,
        "length": int(attr("data-length")) if attr("data-length") else 0,
        "kanji": int(attr("data-kanji")) if attr("data-kanji") else 0,
        "summary": summary,
        "setting": setting,
        "themes": themes,
        "distinctiveness": distinctiveness,
        "sexual_notes": sexual_notes,
        "card_url": card_url,
        "read_url": read_url,
    }


def main() -> None:
    entries: list[dict] = []
    for section in SECTIONS:
        path = SRC / f"{section}.html"
        if not path.exists() and not path.with_name(path.name + ".gz").exists():
            print(f"skip missing {path}", file=sys.stderr)
            continue
        raw = read_source(path)
        found = re.findall(r"<article .*?</article>", raw, re.S)
        parsed = [parse_article(a) for a in found]
        for e in parsed:
            if e["section"] == "":
                e["section"] = section
        entries.extend(parsed)
        print(f"{section}: {len(parsed):>5} entries")

    entries.sort(key=lambda e: e["n"])
    numbers = [e["n"] for e in entries]
    assert len(numbers) == len(set(numbers)), "duplicate entry numbers"

    OUT.mkdir(exist_ok=True)
    (OUT / "entries.json").write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"total: {len(entries)} entries -> data/entries.json")

    # quick stats
    for key in ("year_source", "form", "sexual_level"):
        counts = {}
        for e in entries:
            counts[e[key]] = counts.get(e[key], 0) + 1
        print(key, sorted(counts.items(), key=lambda kv: -kv[1]))
    print("genres", len({g for e in entries for g in e["genres"]}))
    print("summary chars", sum(len(e["summary"]) for e in entries))
    print("analysis chars", sum(len(" ".join(e["setting"])) + len(e["distinctiveness"]) + len(e["sexual_notes"]) + len(" ".join(e["themes"])) for e in entries))


if __name__ == "__main__":
    main()
