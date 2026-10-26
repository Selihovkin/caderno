/* Caderno: небольшие удобства на страницах.
 * Прогресс и настройка «скрыть переводы» хранятся только в браузере читателя (localStorage).
 */
(function () {
  "use strict";

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* хранилище недоступно: просто не запоминаем */ }
  }
  function isDone(slug) { return load("caderno-done-" + slug) === "1"; }

  // ---------- статусы уроков в списке и прогресс ----------
  function renderStatuses() {
    var links = document.querySelectorAll(".lesson-list [data-lesson]");
    var done = 0;
    links.forEach(function (a) {
      var d = isDone(a.getAttribute("data-lesson"));
      if (d) done++;
      var s = a.querySelector("[data-status]");
      if (!s) return;
      s.className = "status " + (d ? "status-done" : "status-new");
      s.textContent = d ? "Пройден" : "Новый";
    });
    document.querySelectorAll("[data-progress]").forEach(function (el) {
      el.textContent = "Пройдено " + done + " из " + el.getAttribute("data-total");
    });
  }

  // ---------- кнопки на странице урока ----------
  function applyRu(hidden) {
    document.body.classList.toggle("hide-ru", hidden);
    document.querySelectorAll(".js-ru").forEach(function (b) {
      b.setAttribute("aria-pressed", hidden ? "true" : "false");
      b.textContent = hidden ? "Показать переводы" : "Скрыть переводы";
    });
    document.querySelectorAll(".ru.shown").forEach(function (el) { el.classList.remove("shown"); });
  }

  function applyDone() {
    document.querySelectorAll(".js-done").forEach(function (b) {
      var d = isDone(b.getAttribute("data-lesson"));
      b.setAttribute("aria-pressed", d ? "true" : "false");
      b.textContent = d ? "Пройден ✓" : "Отметить как пройденный";
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest(".js-ru")) {
      var hide = !document.body.classList.contains("hide-ru");
      applyRu(hide);
      save("caderno-hide-ru", hide ? "1" : null);
      return;
    }
    var doneBtn = e.target.closest(".js-done");
    if (doneBtn) {
      var slug = doneBtn.getAttribute("data-lesson");
      save("caderno-done-" + slug, isDone(slug) ? null : "1");
      applyDone();
      renderStatuses();
      return;
    }
    var ru = e.target.closest(".ru");
    if (ru && document.body.classList.contains("hide-ru")) ru.classList.toggle("shown");
  });

  // ---------- оглавление урока ----------
  function buildToc() {
    var blocks = document.querySelectorAll("[data-toc-title]");
    if (!blocks.length) return;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll("[data-toc]").forEach(function (nav) {
      var ol = document.createElement("ol");
      blocks.forEach(function (b) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = "#" + b.id;
        a.textContent = b.getAttribute("data-toc-title");
        a.addEventListener("click", function (e) {
          e.preventDefault();
          b.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
          if (history.replaceState) history.replaceState(null, "", "#" + b.id);
          var d = nav.closest("details");
          if (d) d.open = false;
        });
        li.appendChild(a);
        ol.appendChild(li);
      });
      nav.appendChild(ol);
    });
  }

  // ---------- декоративная плитка-азулежу на главной ----------
  function buildTiles() {
    var tiles = document.getElementById("tiles");
    if (!tiles) return;
    for (var i = 0; i < 16; i++) {
      var r = (i % 4 + Math.floor(i / 4)) % 2 === 0;
      var a = r ? "var(--accent)" : "var(--accent-soft)";
      var b = r ? "var(--surface)" : "var(--accent)";
      var c = r ? "var(--accent)" : "var(--surface)";
      tiles.insertAdjacentHTML("beforeend",
        '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="' + a + '"/>' +
        '<path d="M20 4 C24 12 28 16 36 20 C28 24 24 28 20 36 C16 28 12 24 4 20 C12 16 16 12 20 4Z" fill="' + b + '"/>' +
        '<circle cx="20" cy="20" r="4" fill="' + c + '"/>' +
        '<path d="M0 0 L8 0 A8 8 0 0 1 0 8Z M40 0 L40 8 A8 8 0 0 1 32 0Z M0 40 L0 32 A8 8 0 0 1 8 40Z M40 40 L32 40 A8 8 0 0 1 40 32Z" fill="' + b + '" opacity="0.7"/></svg>');
    }
  }

  buildTiles();
  buildToc();
  applyRu(load("caderno-hide-ru") === "1");
  applyDone();
  renderStatuses();
})();
