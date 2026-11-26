#!/usr/bin/env node
/*
 * Builds the site into dist/ for Cloudflare Pages.
 *
 * Everything in the repo is copied as-is, except that the Cards page, each card's own page
 * and the sitemap are generated from cards.json (the file the /admin card manager edits).
 *
 * Usage: node build.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const SITE = "https://www.minicards.com.au";
const CATEGORIES = ["see-and-do", "eat-and-drink", "shopping", "culture", "various"];

// Not part of the public site
const SKIP = new Set([
  "dist", "functions", "worker", "_templates", "node_modules", ".git", ".github", ".wrangler",
  "build.js", "cards.json", "package.json", "package-lock.json", "README.md", ".gitignore",
  ".assetsignore", ".DS_Store", "wrangler.toml", "wrangler.jsonc",
]);

const tpl = (name) => fs.readFileSync(path.join(ROOT, "_templates", name), "utf8");
const fill = (t, vars) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (src === ROOT && SKIP.has(ent.name)) continue;
    if (ent.name === ".DS_Store") continue;
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function imgTag(img, alt, eager) {
  const size = img.width && img.height ? ` width="${img.width}" height="${img.height}"` : "";
  const loading = eager ? "" : ' loading="lazy"';
  return `<img decoding="async"${loading}${size} src="${esc(img.src)}" class="attachment-large size-large" alt="${esc(alt)}" />`;
}

function validate(cards) {
  const slugs = new Set();
  for (const c of cards) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)) throw new Error(`Bad slug: ${c.slug}`);
    if (slugs.has(c.slug)) throw new Error(`Duplicate slug: ${c.slug}`);
    slugs.add(c.slug);
    if (!c.title) throw new Error(`Card ${c.slug} has no title`);
    if (!c.front || !c.front.src) throw new Error(`Card ${c.slug} has no front image`);
    for (const cat of c.categories || []) if (!CATEGORIES.includes(cat)) throw new Error(`Bad category ${cat} on ${c.slug}`);
    for (const img of [c.front, c.back]) {
      if (img && !fs.existsSync(path.join(ROOT, img.src))) throw new Error(`Missing image ${img.src} for ${c.slug}`);
    }
  }
}

function build() {
  const { cards } = JSON.parse(fs.readFileSync(path.join(ROOT, "cards.json"), "utf8"));
  validate(cards);
  const live = cards.filter((c) => !c.hidden);

  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(ROOT, OUT);

  // --- the Cards page (one grid per category tab)
  const item = tpl("card-item.html");
  let page = tpl("cards-page.html");
  for (const cat of CATEGORIES) {
    const html = live
      .filter((c) => (c.categories || []).includes(cat))
      .map((c, i) => fill(item, {
        ID: c.id,
        CATEGORY_CLASSES: (c.categories || []).map((x) => `service_type-${x}`).join(" "),
        IMG: imgTag(c.front, `${c.title} minicard`, cat === CATEGORIES[0] && i < 5),
      }))
      .join("\n\t\t\t\t");
    page = page.replace(`<!--CARDS:${cat}-->`, html);
  }
  fs.mkdirSync(path.join(OUT, "cards"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "cards", "index.html"), page);

  // --- one page per card
  const cardT = tpl("card.html"), secT = tpl("card-images-section.html");
  const frontT = tpl("card-front-column.html"), backT = tpl("card-back-column.html"), emptyT = tpl("card-empty-column.html");
  for (const c of live) {
    const section = fill(secT, {
      FRONT_COLUMN: fill(frontT, { IMG: imgTag(c.front, `${c.title} minicard (front)`, true) }),
      BACK_COLUMN: c.back ? fill(backT, { IMG: imgTag(c.back, `${c.title} minicard (back)`, true) }) : emptyT,
    });
    const html = fill(cardT, {
      IMAGES_SECTION: section,
      TITLE: esc(c.title),
      TITLE_URL: encodeURIComponent(c.title),
      SLUG: c.slug,
      ID: c.id,
      CATEGORY_CLASSES: (c.categories || []).map((x) => `service_type-${x}`).join(" "),
    });
    const dir = path.join(OUT, "cards", c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
  }

  // --- sitemap: every page in dist (except 404 and admin)
  const urls = [];
  (function walk(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (rel === "" && /^(wp-|admin$|assets$)/.test(ent.name)) continue;
        walk(path.join(dir, ent.name), rel + ent.name + "/");
      } else if (ent.name === "index.html") urls.push("/" + rel);
    }
  })(OUT, "");
  urls.sort();
  fs.writeFileSync(path.join(OUT, "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n") + "\n</urlset>\n");

  console.log(`Built ${live.length} cards (${cards.length - live.length} hidden), ${urls.length} pages in sitemap.`);
}

build();
