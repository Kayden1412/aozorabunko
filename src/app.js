/* Aozora reading guide — list page controller (no dependencies). */
(() => {
  "use strict";

  const body = document.body;
  const section = body.dataset.section || "fiction";
  const base = body.dataset.base || "/";
  const indexUrl = body.dataset.index || "";
  const searchUrl = body.dataset.search || "";
  const PAGE = 24;
  const BOOKMARK_ICON =
    '<svg class="icon" viewBox="0 0 384 512" aria-hidden="true" focusable="false">' +
    "<!--!Font Awesome Free v7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.-->" +
    '<path d="M0 64C0 28.7 28.7 0 64 0L320 0c35.3 0 64 28.7 64 64l0 417.1c0 25.6-28.5 40.8-49.8 26.6L192 412.8 49.8 507.7C28.5 521.9 0 506.6 0 481.1L0 64zM64 48c-8.8 0-16 7.2-16 16l0 387.2 117.4-78.2c16.1-10.7 37.1-10.7 53.2 0L336 451.2 336 64c0-8.8-7.2-16-16-16L64 48z"/>' +
    "</svg>";
  const BOOKMARK_ICON_ON =
    '<svg class="icon" viewBox="0 0 384 512" aria-hidden="true" focusable="false">' +
    "<!--!Font Awesome Free v7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.-->" +
    '<path d="M64 0C28.7 0 0 28.7 0 64L0 480c0 11.5 6.2 22.2 16.2 27.8s22.3 5.5 32.2-.4L192 421.3 335.5 507.4c9.9 5.9 22.2 6.1 32.2 .4S384 491.5 384 480l0-416c0-35.3-28.7-64-64-64L64 0z"/>' +
    "</svg>";

  const metaEl = document.getElementById("site-meta");
  const META = metaEl ? JSON.parse(metaEl.textContent) : {};
  const labels = META.labels || { forms: {}, genres: {}, sexual: {}, tags: {}, sections: {} };

  const $ = (sel) => document.querySelector(sel);
  const list = $("#list");
  const sentinel = $("#sentinel");
  const countEl = $("#count");
  const statusEl = $("#status");
  const emptyEl = $("#empty");
  const searchEl = $("#search");
  const scoreEl = $("#distinctiveness");
  const sortEl = $("#sort");
  const bookmarksEl = $("#bookmarks");
  const filtersEl = $("#filters");
  const activeCountEl = $("#active-count");
  const filterButtons = Array.from(filtersEl.querySelectorAll("button.opt"));

  function paintButton(btn, state) {
    btn.dataset.state = state;
    btn.setAttribute("aria-pressed", state === "in" ? "true" : state === "out" ? "mixed" : "false");
    const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
    let suffix = "";
    if (state === "in") suffix = " (included)";
    else if (state === "out") suffix = " (excluded)";
    btn.setAttribute("aria-label", label + suffix);
    if (state === "in") btn.title = "Included — click to exclude";
    else if (state === "out") btn.title = "Excluded — click to clear";
    else btn.title = "Include " + label + " — click again to exclude";
  }

  function cycleButton(btn) {
    const current = btn.dataset.state;
    paintButton(btn, current === "off" ? "in" : current === "in" ? "out" : "off");
  }

  const groupState = (name) => {
    const yes = [];
    const no = [];
    filterButtons.forEach((btn) => {
      if (btn.dataset.group !== name) return;
      if (btn.dataset.state === "in") yes.push(btn.dataset.value);
      else if (btn.dataset.state === "out") no.push(btn.dataset.value);
    });
    return { yes, no };
  };

  const setGroup = (name, yes, no) => {
    filterButtons.forEach((btn) => {
      if (btn.dataset.group !== name) return;
      const value = btn.dataset.value;
      paintButton(btn, no.includes(value) ? "out" : yes.includes(value) ? "in" : "off");
    });
  };

  const BM_KEY = "aozora-bookmarks";
  const collator = new Intl.Collator("ja");
  const raf = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 0);

  let authors = [];
  let forms = [];
  let genres = [];
  let sexualLevels = [];
  let tags = [];
  let rows = [];
  let results = [];
  let rendered = 0;
  let ready = false;
  let full = null;
  let fullLoading = false;
  let fullLoaded = false;
  let searchBlobs = new Map();
  let renderToken = 0;

  const bookmarks = new Set(loadBookmarks());

  function loadBookmarks() {
    try {
      const raw = JSON.parse(localStorage.getItem(BM_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((n) => Number.isInteger(n)) : [];
    } catch {
      return [];
    }
  }

  function saveBookmarks() {
    try {
      localStorage.setItem(BM_KEY, JSON.stringify([...bookmarks]));
    } catch {
      /* storage unavailable */
    }
  }

  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function authorOf(row) {
    return row[3] >= 0 && authors[row[3]] ? authors[row[3]] : ["", ""];
  }

  function formKey(row) {
    return forms[row[7]] || "";
  }

  function genreKeys(row) {
    return row[8].map((i) => genres[i]).filter(Boolean);
  }

  function tagKeys(row) {
    return row[11].map((i) => tags[i]).filter(Boolean);
  }

  function yearText(row) {
    if (row[6] === 1) return "? (author died " + row[5] + ")";
    if (row[6] === 2 || row[5] == null) return "?";
    return String(row[5]);
  }

  function yearValue(row) {
    return row[6] === 0 ? row[5] : null;
  }

  function fmtLength(n) {
    return Number(n || 0).toLocaleString("en-US") + " chars";
  }

  function excerptOf(row) {
    return row[14] || "";
  }

  function themesOf(row) {
    return Array.isArray(row[15]) ? row[15] : [];
  }

  function card(row) {
    const [ja, en, jaUrl, enUrl] = authorOf(row);
    const article = el("article", "card");
    article.dataset.n = String(row[0]);
    article.id = "entry-" + row[0];

    const top = el("div", "card-top");
    top.appendChild(el("span", "entry-no", "#" + String(row[0]).padStart(6, "0")));
    const bm = el("button", "bm");
    bm.type = "button";
    bm.dataset.n = String(row[0]);
    const isSet = bookmarks.has(row[0]);
    bm.setAttribute("aria-pressed", String(isSet));
    bm.setAttribute("aria-label", (isSet ? "Remove bookmark for " : "Bookmark ") + row[1]);
    bm.title = isSet ? "Remove bookmark" : "Bookmark";
    bm.innerHTML = isSet ? BOOKMARK_ICON_ON : BOOKMARK_ICON;
    top.appendChild(bm);
    article.appendChild(top);

    const h2 = el("h2");
    const link = el("a", null, row[1]);
    link.lang = "ja";
    link.href = base + "work/?n=" + row[0];
    h2.appendChild(link);
    article.appendChild(h2);

    if (row[2]) {
      const subtitle = el("p", "subtitle", row[2]);
      subtitle.lang = "ja";
      article.appendChild(subtitle);
    }

    if (ja) {
      const p = el("p", "author");
      if (jaUrl) {
        const a = el("a", null, ja);
        a.lang = "ja";
        a.href = jaUrl;
        a.target = "_blank";
        a.rel = "noopener";
        p.appendChild(a);
      } else {
        const span = el("span", null, ja);
        span.lang = "ja";
        p.appendChild(span);
      }
      if (en) {
        p.appendChild(document.createTextNode(" "));
        const span = el("span", "en", "(");
        if (enUrl) {
          const a = el("a", null, en);
          a.href = enUrl;
          a.target = "_blank";
          a.rel = "noopener";
          span.appendChild(a);
        } else {
          span.appendChild(document.createTextNode(en));
        }
        span.appendChild(document.createTextNode(")"));
        p.appendChild(span);
      }
      article.appendChild(p);
    }

    const chips = el("ul", "chips");
    genreKeys(row).forEach((key) => chips.appendChild(el("li", null, labels.genres[key] || key)));
    if (chips.children.length) article.appendChild(chips);

    const ex = excerptOf(row);
    if (ex) article.appendChild(el("p", "excerpt", ex));

    const themes = themesOf(row);
    if (themes.length) {
      const p = el("p", "themes");
      p.appendChild(el("strong", null, "Themes"));
      p.appendChild(document.createTextNode(" " + themes.join(" · ")));
      article.appendChild(p);
    }

    const facts = el("p", "facts");
    facts.appendChild(el("span", null, yearText(row)));
    facts.appendChild(el("span", null, labels.forms[formKey(row)] || formKey(row)));
    facts.appendChild(el("span", null, fmtLength(row[12])));
    const kanji = el("span", null, Number(row[13] || 0).toLocaleString("en-US") + " unique kanji");
    kanji.title = "Unique kanji count";
    facts.appendChild(kanji);
    const score = el("span", "score", "Distinctive " + row[9] + "/5");
    facts.appendChild(score);
    article.appendChild(facts);

    const more = el("p", "card-more");
    const moreLink = el("a", null, "Read the analysis →");
    moreLink.href = base + "work/?n=" + row[0];
    more.appendChild(moreLink);
    article.appendChild(more);

    return article;
  }

  function state() {
    const form = groupState("form");
    const genre = groupState("genre");
    const sex = groupState("sex");
    const tag = groupState("tag");
    return {
      q: searchEl.value.trim(),
      forms: form.yes,
      notForms: form.no,
      genres: genre.yes,
      notGenres: genre.no,
      score: scoreEl.value,
      sexuals: sex.yes,
      notSexuals: sex.no,
      tags: tag.yes,
      notTags: tag.no,
      sort: sortEl.value,
      bm: bookmarksEl.getAttribute("aria-pressed") === "true",
    };
  }

  function isDefault(s) {
    return (
      !s.q &&
      !s.forms.length &&
      !s.notForms.length &&
      !s.genres.length &&
      !s.notGenres.length &&
      (!s.score || s.score === "0") &&
      !s.sexuals.length &&
      !s.notSexuals.length &&
      !s.tags.length &&
      !s.notTags.length &&
      s.sort === "number" &&
      !s.bm
    );
  }

  function blob(row) {
    const key = row[0];
    const cached = searchBlobs.get(key);
    if (cached) return cached;
    const [ja, en] = authorOf(row);
    let text = [row[1], row[2], ja, en, row[4], labels.forms[formKey(row)] || formKey(row)];
    genreKeys(row).forEach((k) => text.push(labels.genres[k] || k));
    themesOf(row).forEach((t) => text.push(t));
    if (full && full[key]) text = text.concat(full[key]);
    const value = norm(text.join(" "));
    searchBlobs.set(key, value);
    return value;
  }

  function applyFilters(s) {
    const terms = s.q ? norm(s.q).split(/\s+/).filter(Boolean) : [];
    const out = [];
    for (const row of rows) {
      if (s.forms.length && !s.forms.includes(formKey(row))) continue;
      if (s.notForms.length && s.notForms.includes(formKey(row))) continue;
      if (s.genres.length && !row[8].some((i) => s.genres.includes(genres[i]))) continue;
      if (s.notGenres.length && row[8].some((i) => s.notGenres.includes(genres[i]))) continue;
      if (s.score && s.score !== "0" && row[9] < Number(s.score)) continue;
      if (s.sexuals.length && !s.sexuals.includes(sexualLevels[row[10]])) continue;
      if (s.notSexuals.length && s.notSexuals.includes(sexualLevels[row[10]])) continue;
      if (s.tags.length) {
        const noTags = s.tags.includes("__none");
        const positive = s.tags.filter((tag) => tag !== "__none");
        const hasNone = row[11].length === 0;
        const hasMatch = row[11].some((i) => positive.includes(tags[i]));
        if (!((noTags && hasNone) || hasMatch)) continue;
      }
      if (s.notTags.length) {
        const noTags = s.notTags.includes("__none");
        const positive = s.notTags.filter((tag) => tag !== "__none");
        const hasNone = row[11].length === 0;
        const hasMatch = row[11].some((i) => positive.includes(tags[i]));
        if ((noTags && hasNone) || hasMatch) continue;
      }
      if (s.bm && !bookmarks.has(row[0])) continue;
      if (terms.length) {
        const text = blob(row);
        let ok = true;
        for (const term of terms) {
          if (!text.includes(term)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      out.push(row);
    }
    sortRows(out, s.sort);
    return out;
  }

  function sortRows(out, sort) {
    switch (sort) {
      case "number":
        out.sort((a, b) => a[0] - b[0]);
        break;
      case "number-desc":
        out.sort((a, b) => b[0] - a[0]);
        break;
      case "author":
        out.sort((a, b) => collator.compare(authorOf(a)[0], authorOf(b)[0]) || a[0] - b[0]);
        break;
      case "author-desc":
        out.sort((a, b) => collator.compare(authorOf(b)[0], authorOf(a)[0]) || a[0] - b[0]);
        break;
      case "distinctiveness":
        out.sort((a, b) => b[9] - a[9] || a[0] - b[0]);
        break;
      case "distinctiveness-asc":
        out.sort((a, b) => a[9] - b[9] || a[0] - b[0]);
        break;
      case "length":
        out.sort((a, b) => b[12] - a[12] || a[0] - b[0]);
        break;
      case "length-asc":
        out.sort((a, b) => a[12] - b[12] || a[0] - b[0]);
        break;
      case "kanji":
        out.sort((a, b) => b[13] - a[13] || a[0] - b[0]);
        break;
      case "kanji-asc":
        out.sort((a, b) => a[13] - b[13] || a[0] - b[0]);
        break;
      case "year-desc":
        out.sort((a, b) => cmpYearDesc(a, b));
        break;
      case "year-asc":
        out.sort((a, b) => cmpYear(a, b));
        break;
      default:
        out.sort((a, b) => a[0] - b[0]);
    }
  }

  function cmpYear(a, b) {
    const av = yearValue(a);
    const bv = yearValue(b);
    if (av == null && bv == null) return a[0] - b[0];
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv || a[0] - b[0];
  }

  function cmpYearDesc(a, b) {
    const av = yearValue(a);
    const bv = yearValue(b);
    if (av == null && bv == null) return a[0] - b[0];
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || a[0] - b[0];
  }

  function updateCount() {
    const total = results.length;
    const filtered = !isDefault(state());
    const noun = filtered ? (total === 1 ? "match" : "matches") : total === 1 ? "work" : "works";
    countEl.innerHTML = "<strong>" + total.toLocaleString("en-US") + "</strong> " + noun;
    emptyEl.hidden = total > 0;
  }

  function renderReset() {
    renderToken++;
    rendered = 0;
    list.textContent = "";
    renderPage();
  }

  function renderPage() {
    if (!ready) return;
    const token = renderToken;
    const slice = results.slice(rendered, rendered + PAGE);
    const frag = document.createDocumentFragment();
    for (const row of slice) frag.appendChild(card(row));
    list.appendChild(frag);
    rendered += slice.length;
    updateCount();
    if (rendered < results.length && token === renderToken && sentinelAreNear()) {
      raf(renderPage);
    }
  }

  function sentinelAreNear() {
    return sentinel.getBoundingClientRect().top < window.innerHeight + 900;
  }

  function refresh({ updateUrl = true } = {}) {
    if (!ready) {
      updateActiveCount();
      return;
    }
    const s = state();
    results = applyFilters(s);
    renderReset();
    if (updateUrl) syncUrl(s);
    updateActiveCount();
  }

  function syncUrl(s) {
    const p = new URLSearchParams();
    if (s.q) p.set("q", s.q);
    s.forms.forEach((value) => p.append("form", value));
    s.notForms.forEach((value) => p.append("not_form", value));
    s.genres.forEach((value) => p.append("genre", value));
    s.notGenres.forEach((value) => p.append("not_genre", value));
    if (s.score && s.score !== "0") p.set("score", s.score);
    s.sexuals.forEach((value) => p.append("sex", value));
    s.notSexuals.forEach((value) => p.append("not_sex", value));
    s.tags.forEach((value) => p.append("tag", value));
    s.notTags.forEach((value) => p.append("not_tag", value));
    if (s.sort !== "number") p.set("sort", s.sort);
    if (s.bm) p.set("bm", "1");
    const query = p.toString();
    history.replaceState(null, "", location.pathname + (query ? "?" + query : ""));
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    searchEl.value = p.get("q") || "";
    setGroup("form", p.getAll("form"), p.getAll("not_form"));
    setGroup("genre", p.getAll("genre"), p.getAll("not_genre"));
    setGroup("sex", p.getAll("sex"), p.getAll("not_sex"));
    setGroup("tag", p.getAll("tag"), p.getAll("not_tag"));
    scoreEl.value = p.get("score") || "0";
    sortEl.value = p.get("sort") || "number";
    bookmarksEl.setAttribute("aria-pressed", p.get("bm") === "1" ? "true" : "false");
    filtersEl.open = [...p.keys()].some((k) => k !== "sort");
  }

  function updateActiveCount() {
    const s = state();
    let n =
      s.forms.length +
      s.notForms.length +
      s.genres.length +
      s.notGenres.length +
      s.sexuals.length +
      s.notSexuals.length +
      s.tags.length +
      s.notTags.length;
    if (s.score && s.score !== "0") n++;
    if (s.sort !== "number") n++;
    if (s.bm) n++;
    activeCountEl.textContent = n ? "· " + n + " active" : "";
    bookmarksEl.innerHTML =
      (bookmarksEl.getAttribute("aria-pressed") === "true" ? BOOKMARK_ICON_ON : BOOKMARK_ICON) +
      " Bookmarks" +
      (bookmarks.size ? " (" + bookmarks.size + ")" : "");
  }

  function updateBookmarkButtons() {
    list.querySelectorAll(".bm").forEach((b) => {
      const n = Number(b.dataset.n);
      const set = bookmarks.has(n);
      b.setAttribute("aria-pressed", String(set));
      b.innerHTML = set ? BOOKMARK_ICON_ON : BOOKMARK_ICON;
      b.title = set ? "Remove bookmark" : "Bookmark";
      const title = b.closest(".card")?.querySelector("h2")?.textContent || "";
      b.setAttribute("aria-label", (set ? "Remove bookmark for " : "Bookmark ") + title);
    });
  }

  function toggleBookmark(n) {
    if (bookmarks.has(n)) bookmarks.delete(n);
    else bookmarks.add(n);
    saveBookmarks();
    updateBookmarkButtons();
    updateActiveCount();
    if (state().bm) refresh({ updateUrl: true });
  }

  function loadFull() {
    if (fullLoaded || fullLoading || !searchUrl) return;
    fullLoading = true;
    statusEl.textContent = "Loading full-text search…";

    fetchCborShard(searchUrl)
      .then((data) => {
        full = {};
        for (const row of data) {
          full[row[0]] = [row[1], row[2], row[3], row[4]];
        }
        fullLoaded = true;
        searchBlobs.clear();
        statusEl.textContent = "";
        if (searchEl.value.trim()) refresh({ updateUrl: false });
      })
      .catch(() => {
        statusEl.textContent = "Full-text search unavailable.";
      })
      .finally(() => {
        fullLoading = false;
      });
  }

  let debounceTimer = 0;
  let fullTimer = 0;
  function debouncedRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refresh(), 140);
  }

  function resetFilters() {
    searchEl.value = "";
    filterButtons.forEach((btn) => paintButton(btn, "off"));
    scoreEl.value = "0";
    sortEl.value = "number";
    bookmarksEl.setAttribute("aria-pressed", "false");
    refresh();
  }

  function wire() {
    searchEl.addEventListener("input", () => {
      const query = searchEl.value.trim();
      clearTimeout(fullTimer);
      if (query) {
        fullTimer = window.setTimeout(loadFull, query.length >= 2 ? 450 : 900);
      }
      debouncedRefresh();
    });
    filterButtons.forEach((btn) =>
      btn.addEventListener("click", () => {
        cycleButton(btn);
        refresh();
      })
    );
    [scoreEl, sortEl].forEach((node) => {
      node.addEventListener("change", () => refresh());
    });
    bookmarksEl.addEventListener("click", () => {
      const next = bookmarksEl.getAttribute("aria-pressed") !== "true";
      bookmarksEl.setAttribute("aria-pressed", String(next));
      refresh();
    });
    filtersEl.addEventListener("reset", (event) => {
      event.preventDefault();
      resetFilters();
    });
    emptyEl.addEventListener("click", (event) => {
      if (!event.target.closest("#empty-reset")) return;
      event.preventDefault();
      resetFilters();
    });
    list.addEventListener("click", (event) => {
      const bm = event.target.closest(".bm");
      if (!bm) return;
      event.preventDefault();
      toggleBookmark(Number(bm.dataset.n));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement !== searchEl && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        event.preventDefault();
        searchEl.focus();
      }
    });
    window.addEventListener("popstate", () => {
      if (!ready) return;
      readUrl();
      refresh({ updateUrl: false });
    });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          if (!ready) return;
          if (rendered < results.length) renderPage();
        },
        { rootMargin: "900px 0px" }
      );
      io.observe(sentinel);
    } else {
      sentinel.addEventListener("click", () => renderPage());
    }
  }

  function init() {
    ready = true;
    readUrl();
    const s = state();
    const defaultView = isDefault(s) && !location.search;
    results = applyFilters(s);
    updateActiveCount();
    updateBookmarkButtons();
    if (defaultView) {
      const ssrCount = list.querySelectorAll(".card").length;
      rendered = Math.min(ssrCount, results.length);
      updateCount();
    } else {
      renderReset();
      filtersEl.open = [...new URLSearchParams(location.search).keys()].some((k) => k !== "sort");
    }
    if (rendered < results.length && sentinelAreNear()) {
      raf(renderPage);
    }
  }

  function fail(message) {
    statusEl.textContent = "";
    statusEl.appendChild(document.createTextNode(message + " "));
    const retry = el("button", "retry", "Retry");
    retry.type = "button";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      loadIndex();
    });
    statusEl.appendChild(retry);
    statusEl.appendChild(document.createTextNode("."));
    updateBookmarkButtons();
  }

  function loadIndex() {
    statusEl.textContent = "Loading the filter index…";
    fetch(indexUrl)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        authors = data.a || [];
        forms = data.f || [];
        genres = data.g || [];
        sexualLevels = data.x || [];
        tags = data.t || [];
        rows = data.rows || [];
        if (statusEl.textContent === "Loading the filter index…") statusEl.textContent = "";
        init();
      })
      .catch(() => fail("Could not load the filter index. Browsing still works."));
  }

  if (!list) return;
  wire();
  loadIndex();
})();
