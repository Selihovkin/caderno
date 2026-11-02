#!/usr/bin/env node
/*
 * Сборка сайта Caderno. Никаких внешних зависимостей: нужен только Node.js 18+.
 *
 *   node build.js            собрать сайт в папку _site
 *   node build.js --serve    собрать и открыть на http://localhost:8080
 *
 * Переменная окружения BASE_PATH задаёт префикс адресов, если сайт живёт
 * не в корне домена (например "/caderno" для логин.github.io/caderno).
 * На GitHub её подставляет workflow автоматически.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

process.on("uncaughtException", (e) => {
  console.error("Ошибка сборки: " + e.message);
  process.exit(1);
});

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "_site");
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "");
const VERSION = Date.now().toString(36);

// ---------- утилиты ----------

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function write(rel, content) {
  const target = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Подставляет {{ключ}} из data. Неизвестный ключ — ошибка, чтобы опечатки не уходили на сайт.
function render(template, data, where) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!(key in data)) throw new Error(`${where}: неизвестная подстановка {{${key}}}`);
    return data[key];
  });
}

// Шапка файла между строками "---": простые пары "ключ: значение".
function parseFile(file) {
  const text = read(file).replace(/^﻿/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: нет шапки между строками ---`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) throw new Error(`${file}: строка шапки без двоеточия: "${line}"`);
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key === "related") (meta.related = meta.related || []).push(value);
    else meta[key] = value;
  }
  return { meta, body: m[2] };
}

// Ссылки вида href="/..." и src="/..." получают префикс BASE_PATH.
function withBase(html) {
  if (!BASE) return html;
  return html.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`);
}

// ---------- данные ----------

const site = JSON.parse(read(path.join(SRC, "site.json")));
const layoutBase = read(path.join(SRC, "layouts", "base.html"));
const layoutLesson = read(path.join(SRC, "layouts", "lesson.html"));

const lessons = fs
  .readdirSync(path.join(SRC, "lessons"))
  .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
  .map((f) => {
    const file = path.join(SRC, "lessons", f);
    const { meta, body } = parseFile(file);
    for (const key of ["number", "slug", "title", "description", "category", "level"]) {
      if (!meta[key]) throw new Error(`${f}: в шапке не хватает поля "${key}"`);
    }
    if (!/^[a-z0-9-]+$/.test(meta.slug)) {
      throw new Error(`${f}: slug может содержать только латиницу, цифры и дефис`);
    }
    return { ...meta, number: Number(meta.number), body, file: f };
  })
  .sort((a, b) => a.number - b.number);

const slugs = new Set();
for (const l of lessons) {
  if (slugs.has(l.slug)) throw new Error(`Два урока с одинаковым slug "${l.slug}"`);
  slugs.add(l.slug);
}

// «Ещё по теме»: строки вида  related: slug#раздел | чем связан
for (const l of lessons) {
  l.relatedLinks = (l.related || []).map((line) => {
    const bar = line.indexOf("|");
    const target = (bar < 0 ? line : line.slice(0, bar)).trim();
    const note = bar < 0 ? "" : line.slice(bar + 1).trim();
    const [slug, anchor] = target.split("#");
    const other = lessons.find((x) => x.slug === slug);
    if (!other) throw new Error(`${l.file}: related ссылается на несуществующий урок "${slug}"`);
    if (other.slug === l.slug) throw new Error(`${l.file}: related ссылается сам на себя`);
    if (anchor && !other.body.includes(`id="${anchor}"`)) {
      throw new Error(`${l.file}: в уроке "${slug}" нет раздела #${anchor}`);
    }
    return { lesson: other, anchor, note };
  });
}

// ---------- кусочки разметки ----------

function tags(category, level) {
  return `<div class="tags"><span class="tag">${escapeHtml(category)}</span><span class="tag">${escapeHtml(level)}</span></div>`;
}

function lessonList() {
  const items = lessons.map(
    (l) => `        <li><a class="lesson-item" href="/licoes/${l.slug}/" data-lesson="${l.slug}">
          <span class="lesson-num">${l.number}</span>
          <div><div class="lesson-title">${escapeHtml(l.title)}</div><p class="lesson-desc">${escapeHtml(l.description)}</p>${tags(l.category, l.level)}</div>
          <span class="status status-new" data-status>Новый</span>
        </a></li>`
  );
  const lastNumber = lessons.length ? lessons[lessons.length - 1].number : 0;
  (site.upcoming || []).forEach((u, i) => {
    items.push(`        <li><div class="lesson-item soon">
          <span class="lesson-num">${lastNumber + i + 1}</span>
          <div><div class="lesson-title">${escapeHtml(u.title)}</div><p class="lesson-desc">${escapeHtml(u.description)}</p>${tags(u.category, u.level)}</div>
          <span class="status status-soon">Скоро</span>
        </div></li>`);
  });
  return `      <ul class="lesson-list">\n${items.join("\n")}\n      </ul>`;
}

const progress = `<span class="progress-note" data-progress data-total="${lessons.length}"></span>`;

function relatedBlock(l) {
  if (!l.relatedLinks.length) return "";
  const cards = l.relatedLinks.map(({ lesson, anchor, note }) =>
    `<a class="related-card" href="/licoes/${lesson.slug}/${anchor ? "#" + anchor : ""}">` +
    `<span class="related-num">${lesson.number}</span>` +
    `<span class="related-text"><b>${escapeHtml(lesson.title)}</b>${note ? `<small>${note}</small>` : ""}</span></a>`
  );
  return `<section class="related" aria-labelledby="related-title">
          <h2 class="related-title" id="related-title">Ещё по теме</h2>
          <div class="related-list">
            ${cards.join("\n            ")}
          </div>
        </section>`;
}

function pagerLinks(i) {
  const prev = lessons[i - 1];
  const next = lessons[i + 1];
  const soon = (site.upcoming || [])[0];
  const prevLink = prev
    ? `<a class="pager-item" href="/licoes/${prev.slug}/"><div class="k">← Предыдущий урок</div><div class="v">${escapeHtml(prev.title)}</div></a>`
    : `<a class="pager-item" href="/licoes/"><div class="k">← Назад</div><div class="v">Все уроки</div></a>`;
  let nextLink;
  if (next) {
    nextLink = `<a class="pager-item next" href="/licoes/${next.slug}/"><div class="k">Следующий урок →</div><div class="v">${escapeHtml(next.title)}</div></a>`;
  } else if (soon) {
    nextLink = `<div class="pager-item next disabled"><div class="k">Следующий урок →</div><div class="v">${escapeHtml(soon.title)} (скоро)</div></div>`;
  } else {
    nextLink = `<a class="pager-item next" href="/licoes/"><div class="k">Все уроки →</div><div class="v">К списку</div></a>`;
  }
  return { prevLink, nextLink };
}

function page(content, { title, description, nav }) {
  const html = render(
    layoutBase,
    {
      pageTitle: escapeHtml(title),
      pageDescription: escapeHtml(description || site.description),
      siteName: escapeHtml(site.name),
      siteTagline: escapeHtml(site.tagline),
      version: VERSION,
      navHome: nav === "home" ? 'aria-current="page"' : "",
      navLessons: nav === "lessons" ? 'aria-current="page"' : "",
      content,
    },
    "layouts/base.html"
  );
  return withBase(html);
}

// ---------- сборка ----------

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));
  copyDir(path.join(ROOT, "img"), path.join(OUT, "img"));
  for (const f of ["favicon.svg", "CNAME"]) {
    if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  }
  write(".nojekyll", "");

  // страницы
  for (const f of fs.readdirSync(path.join(SRC, "pages")).filter((f) => f.endsWith(".html"))) {
    const { meta, body } = parseFile(path.join(SRC, "pages", f));
    const content = render(body, { lessonList: lessonList(), progress }, `pages/${f}`);
    const permalink = meta.permalink || "/";
    const out = permalink.endsWith("/") ? permalink + "index.html" : permalink;
    write(out, page(content, { title: meta.pageTitle || site.name, description: meta.description, nav: meta.key }));
  }

  // уроки
  lessons.forEach((l, i) => {
    const { prevLink, nextLink } = pagerLinks(i);
    const content = render(
      layoutLesson,
      {
        number: String(l.number),
        category: escapeHtml(l.category),
        title: escapeHtml(l.title),
        headingClass: l.heading === "mono" ? ' class="mono"' : "",
        fullTitle: escapeHtml(l.fullTitle || ""),
        intro: l.intro || "",
        slug: l.slug,
        body: l.body.trim().split("\n").map((line) => (line ? "      " + line : line)).join("\n"),
        prevLink,
        nextLink,
        related: relatedBlock(l),
      },
      `lessons/${l.file}`
    );
    write(`licoes/${l.slug}/index.html`, page(content, {
      title: `${l.title} · ${site.name}`,
      description: l.description,
      nav: "lessons",
    }));
  });

  console.log(`Готово: ${lessons.length} урок(а/ов) → _site${BASE ? ` (префикс ${BASE})` : ""}`);
}

// ---------- локальный просмотр ----------

function serve(port) {
  const types = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".ico": "image/x-icon", ".json": "application/json",
  };
  http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (BASE && url.startsWith(BASE)) url = url.slice(BASE.length) || "/";
    let file = path.join(OUT, url);
    if (!file.startsWith(OUT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": types[".html"] });
      return res.end(fs.readFileSync(path.join(OUT, "404.html")));
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`Сайт открыт на http://localhost:${port}${BASE}/  (Ctrl+C — остановить)`));
}

try {
  build();
} catch (e) {
  console.error("Ошибка сборки: " + e.message);
  process.exit(1);
}
if (process.argv.includes("--serve")) serve(Number(process.env.PORT) || 8080);
