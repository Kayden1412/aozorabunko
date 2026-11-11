/* Single-work viewer: fetches a ~100-work CBOR shard and renders it. */
(() => {
  "use strict";

  const root = document.getElementById("work");
  const body = document.body;
  const base = body.dataset.base || "/";
  const worksBase = body.dataset.works || "/data/works/";
  const worksVersion = body.dataset.v || "";
  const META = JSON.parse(document.getElementById("site-meta").textContent).labels;
  const params = new URLSearchParams(location.search);
  const n = Number(params.get("n"));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pagerLink(direction, row) {
    const a = el("a", direction, direction === "prev" ? "← " + row[2] : row[2] + " →");
    a.href = base + "work/?n=" + row[0];
    return a;
  }

  function paintPager(pager, prev, next) {
    pager.textContent = "";
    if (prev) pager.appendChild(pagerLink("prev", prev));
    if (next) pager.appendChild(pagerLink("next", next));
  }

  function adjacentWork(shardNumber, section, direction) {
    if (shardNumber < 0) return Promise.resolve(null);
    const url = worksBase + shardNumber + ".cbor.gz?v=" + worksVersion;
    return fetchCborShard(url)
      .then((rows) => {
        const matches = rows.filter((r) => r[1] === section).sort((a, b) => a[0] - b[0]);
        if (!matches.length) return null;
        return direction === "prev" ? matches[matches.length - 1] : matches[0];
      })
      .catch(() => null);
  }

  function fillPager(pager, row, near) {
    const shardNumber = Math.floor(row[0] / 100);
    const jobs = [];
    if (!near.prev && shardNumber > 0) jobs.push({ key: "prev", shard: shardNumber - 1 });
    if (!near.next) jobs.push({ key: "next", shard: shardNumber + 1 });
    if (!jobs.length) return;

    Promise.all(jobs.map((job) => adjacentWork(job.shard, row[1], job.key))).then((found) => {
      jobs.forEach((job, index) => {
        if (found[index]) near[job.key] = found[index];
      });
      paintPager(pager, near.prev, near.next);
      if (!near.prev && !near.next) pager.remove();
      else pager.hidden = false;
    });
  }

  function yearText(year, source) {
    if (source === "death") return "? (author died " + year + ")";
    if (source === "unknown" || year == null) return "?";
    return String(year);
  }

  function fact(label, value, className) {
    const div = el("div");
    div.appendChild(el("dt", null, label));
    div.appendChild(el("dd", className, value));
    return div;
  }

  function authorNode(row) {
    const [ja, en, jaUrl, enUrl] = [row[4], row[5], row[6], row[7]];
    const frag = document.createDocumentFragment();
    if (jaUrl) {
      const a = el("a", null, ja);
      a.lang = "ja";
      a.href = jaUrl;
      a.target = "_blank";
      a.rel = "noopener";
      frag.appendChild(a);
    } else {
      const span = el("span", null, ja);
      span.lang = "ja";
      frag.appendChild(span);
    }
    if (en) {
      frag.appendChild(document.createTextNode(" "));
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
      frag.appendChild(span);
    }
    return frag;
  }

  function showError(message) {
    root.textContent = "";
    const p = el("p", "empty", message);
    const back = el("a", null, "Browse fiction");
    back.href = base;
    p.appendChild(document.createTextNode(" "));
    p.appendChild(back);
    p.appendChild(document.createTextNode("."));
    root.appendChild(p);
  }

  function render(row, rows) {
    const num = row[0];
    const section = row[1];
    const title = row[2];
    const subtitle = row[3];
    const translator = row[8];
    const year = row[9];
    const yearSource = row[10];
    const form = row[11];
    const genres = row[12];
    const score = row[13];
    const sexualLevel = row[14];
    const sexualTags = row[15];
    const length = row[16];
    const kanji = row[17];
    const summary = row[18];
    const setting = row[19];
    const themes = row[20];
    const distinctiveness = row[21];
    const sexualNotes = row[22];
    const cardUrl = row[23];
    const readUrl = row[24];

    const sectionLabel = META.sections[section] || section;
    const sectionHref = section === "fiction" ? base : base + section + "/";
    const label = (map, key) => map[key] || key;

    const article = el("article", "entry");

    const crumbs = el("nav", "breadcrumbs");
    crumbs.setAttribute("aria-label", "Breadcrumb");
    const sectionLink = el("a", null, sectionLabel);
    sectionLink.href = sectionHref;
    crumbs.appendChild(sectionLink);
    crumbs.appendChild(el("span", "sep", "/"));
    crumbs.appendChild(el("span", null, "#" + String(num).padStart(6, "0")));
    article.appendChild(crumbs);

    const heading = el("h1", null, title);
    heading.lang = "ja";
    article.appendChild(heading);
    if (subtitle) {
      const sub = el("p", "subtitle", subtitle);
      sub.lang = "ja";
      article.appendChild(sub);
    }

    const byline = el("p", "byline");
    byline.appendChild(authorNode(row));
    if (translator) byline.appendChild(el("span", "translator", "Translated by " + translator));
    article.appendChild(byline);

    const tools = el("div", "entry-tools");
    const bm = el("button", "bm-btn");
    bm.id = "bm";
    bm.type = "button";
    bm.dataset.n = String(num);
    bm.setAttribute("aria-pressed", "false");
    bm.setAttribute("aria-label", "Bookmark this work");
    tools.appendChild(bm);
    article.appendChild(tools);

    const facts = el("dl", "factbox");
    facts.appendChild(fact("Year", yearText(year, yearSource)));
    facts.appendChild(fact("Form", label(META.forms, form)));
    facts.appendChild(fact("Genre", genres.map((g) => label(META.genres, g)).join(" · ") || "—"));
    facts.appendChild(fact("Length", Number(length).toLocaleString("en-US") + " characters (~" + Math.max(1, Math.round(length / 420)) + " pages)"));
    facts.appendChild(fact("Unique kanji", Number(kanji).toLocaleString("en-US")));
    facts.appendChild(fact("Distinctiveness", score + " / 5", "score"));
    facts.appendChild(fact("Sexual content", label(META.sexual, sexualLevel)));
    article.appendChild(facts);

    function sectionBlock(titleText, id, build) {
      if (!build) return;
      const h2 = el("h2", "section-title", titleText);
      if (id) h2.id = id;
      article.appendChild(h2);
      build();
    }

    sectionBlock("Summary", "summary", summary && (() => {
      const prose = el("div", "prose");
      prose.appendChild(el("p", null, summary));
      article.appendChild(prose);
    }));

    sectionBlock("Setting", "setting", setting && setting.length && (() => {
      const prose = el("div", "prose");
      setting.forEach((p) => prose.appendChild(el("p", null, p)));
      article.appendChild(prose);
    }));

    sectionBlock("Themes", "themes", themes && themes.length && (() => {
      const list = el("ul", "theme-chips");
      themes.forEach((t) => list.appendChild(el("li", null, t)));
      article.appendChild(list);
    }));

    sectionBlock("Distinctiveness", "distinctiveness", distinctiveness && (() => {
      const prose = el("div", "prose");
      prose.appendChild(el("p", null, distinctiveness));
      article.appendChild(prose);
    }));

    sectionBlock(
      "Sexual content · " + label(META.sexual, sexualLevel),
      "sexual-content",
      (sexualNotes || (sexualTags && sexualTags.length)) && (() => {
        const prose = el("div", "prose");
        if (sexualNotes) prose.appendChild(el("p", null, sexualNotes));
        if (sexualTags && sexualTags.length) {
          const list = el("ul", "theme-chips");
          sexualTags.forEach((t) => list.appendChild(el("li", null, label(META.tags, t))));
          prose.appendChild(list);
        }
        article.appendChild(prose);
      })
    );

    if (cardUrl || readUrl) {
      const sources = el("div", "source-links");
      if (cardUrl) {
        const a = el("a", null, "Bibliographic card ↗");
        a.href = cardUrl;
        a.target = "_blank";
        a.rel = "noopener";
        sources.appendChild(a);
      }
      if (readUrl) {
        const a = el("a", null, "Read on Aozora ↗");
        a.href = readUrl;
        a.target = "_blank";
        a.rel = "noopener";
        sources.appendChild(a);
      }
      article.appendChild(sources);
    }

    const siblings = rows.filter((r) => r[1] === section).sort((a, b) => a[0] - b[0]);
    const index = siblings.findIndex((r) => r[0] === num);
    const near = {
      prev: index > 0 ? siblings[index - 1] : null,
      next: index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null,
    };

    const pager = el("nav", "pager");
    pager.setAttribute("aria-label", "Previous and next work");
    paintPager(pager, near.prev, near.next);
    pager.hidden = !near.prev && !near.next;
    article.appendChild(pager);

    const back = el("a", "back-link", "← All " + sectionLabel.toLowerCase());
    back.href = sectionHref;
    article.appendChild(back);

    root.textContent = "";
    root.appendChild(article);
    root.removeAttribute("aria-busy");

    fillPager(pager, row, near);

    document.title = title + " · " + sectionLabel + " · Aozora";
    const desc = document.querySelector('meta[name="description"]');
    if (desc && summary) desc.setAttribute("content", summary.slice(0, 155));

    document.querySelectorAll(".nav a").forEach((a) => a.removeAttribute("aria-current"));
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.getAttribute("href") === sectionHref) a.setAttribute("aria-current", "page");
    });

    // Bookmark state (same key as the list pages).
    const key = "aozora-bookmarks";
    const get = () => {
      try {
        const v = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    };
    const paint = (on) => {
      bm.setAttribute("aria-pressed", String(on));
      bm.textContent = on ? "★ Bookmarked" : "☆ Bookmark";
    };
    paint(get().includes(num));
    bm.addEventListener("click", () => {
      const on = bm.getAttribute("aria-pressed") !== "true";
      const list = get();
      const i = list.indexOf(num);
      if (on && i < 0) list.push(num);
      if (!on && i >= 0) list.splice(i, 1);
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch {
        /* ignore */
      }
      paint(on);
    });
  }

  if (!Number.isInteger(n) || n < 1) {
    showError("No work selected.");
    return;
  }

  const shard = Math.floor(n / 100);
  const url = body.dataset.works + shard + ".cbor.gz?v=" + body.dataset.v;

  root.setAttribute("aria-busy", "true");
  fetchCborShard(url)
    .then((rows) => {
      const row = rows.find((r) => r[0] === n);
      if (!row) throw new Error("not found");
      render(row, rows);
    })
    .catch(() => showError("Could not load this work."));
})();
