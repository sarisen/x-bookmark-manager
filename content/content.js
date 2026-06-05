/* global XBookmarksParser, chrome */
(function () {
  "use strict";

  const SETTINGS_KEY = "fetchDelaySeconds";
  const DEFAULT_DELAY_SECONDS = 3;
  const MIN_DELAY_SECONDS = 1;
  const MAX_DELAY_SECONDS = 60;

  let fetchDelayMs = DEFAULT_DELAY_SECONDS * 1000;
  const bookmarks = new Map();
  let activeTab = "bookmarks";
  let searchQuery = "";
  let enabled = true;
  let isLoading = false;
  let uiRoot = null;
  let nextCursor = null;
  let lastApiUrl = null;
  let lastApiMeta = null;
  let isFetchingMore = false;
  let seenCursors = new Set();
  let loadAllActive = false;
  let fetchChainTimer = null;
  let pendingRemoveId = null;

  function clampDelaySeconds(value) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return DEFAULT_DELAY_SECONDS;
    return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, n));
  }

  function getDelaySeconds() {
    return fetchDelayMs / 1000;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        { [SETTINGS_KEY]: DEFAULT_DELAY_SECONDS },
        (result) => {
          fetchDelayMs =
            clampDelaySeconds(result[SETTINGS_KEY]) * 1000;
          resolve();
        }
      );
    });
  }

  function injectScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/inject.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function mergeBookmarks(tweets) {
    let added = 0;
    for (const tweet of tweets) {
      if (!tweet?.id || bookmarks.has(tweet.id)) continue;
      bookmarks.set(tweet.id, tweet);
      added++;
    }
    return added;
  }

  function formatRelativeDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return "bugün";
    if (diffDays === 1) return "1g";
    if (diffDays < 7) return `${diffDays}g`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}h`;

    return date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  }

  function formatMonthHeader(iso) {
    const date = new Date(iso);
    return date.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function linkifyText(text) {
    let html = escapeHtml(text);
    html = html.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
    html = html.replace(
      /@([a-zA-Z0-9_]+)/g,
      '<a href="https://x.com/$1" target="_blank" rel="noopener">@$1</a>'
    );
    html = html.replace(
      /#([a-zA-Z0-9_\u0080-\uFFFF]+)/g,
      '<a href="https://x.com/hashtag/$1" target="_blank" rel="noopener">#$1</a>'
    );
    return html;
  }

  function getFilteredBookmarks() {
    const list = Array.from(bookmarks.values()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    if (!searchQuery.trim()) return list;

    const q = searchQuery.toLowerCase();
    return list.filter(
      (b) =>
        b.text?.toLowerCase().includes(q) ||
        b.author?.name?.toLowerCase().includes(q) ||
        b.author?.screenName?.toLowerCase().includes(q)
    );
  }

  function groupByMonth(items) {
    const groups = new Map();
    for (const item of items) {
      const key = item.createdAt
        ? formatMonthHeader(item.createdAt)
        : "Tarihsiz";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  }

  function groupByAuthor(items) {
    const groups = new Map();
    for (const item of items) {
      const key = item.author?.screenName || "unknown";
      if (!groups.has(key)) {
        groups.set(key, { author: item.author, tweets: [] });
      }
      groups.get(key).tweets.push(item);
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.author.name.localeCompare(b.author.name, "tr")
    );
  }

  function renderMedia(media) {
    if (!media?.length) return "";
    return media
      .slice(0, 4)
      .map(
        (m) => `
      <div class="xbm-media-item ${media.length > 1 ? "xbm-media-grid" : ""}">
        <img src="${escapeHtml(m.previewUrl)}" alt="" loading="lazy" />
      </div>`
      )
      .join("");
  }

  function renderQuoted(quoted) {
    if (!quoted) return "";
    return `
      <div class="xbm-quoted">
        <div class="xbm-card-header">
          <img class="xbm-avatar xbm-avatar-sm" src="${escapeHtml(quoted.author.avatarUrl)}" alt="" />
          <div class="xbm-author-meta">
            <span class="xbm-name">${escapeHtml(quoted.author.name)}</span>
            <span class="xbm-handle">@${escapeHtml(quoted.author.screenName)}</span>
          </div>
        </div>
        <div class="xbm-text">${linkifyText(quoted.text)}</div>
        ${quoted.media?.length ? `<div class="xbm-media">${renderMedia(quoted.media)}</div>` : ""}
      </div>`;
  }

  function renderCard(tweet) {
    const verified = tweet.author.verified
      ? '<svg class="xbm-verified" viewBox="0 0 24 24"><path fill="currentColor" d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z"/></svg>'
      : "";

    const removing = pendingRemoveId === tweet.id;

    return `
      <article class="xbm-card${removing ? " xbm-card-removing" : ""}" data-id="${escapeHtml(tweet.id)}">
        <div class="xbm-card-header">
          <img class="xbm-avatar" src="${escapeHtml(tweet.author.avatarUrl)}" alt="" loading="lazy" />
          <div class="xbm-author-meta">
            <div class="xbm-name-row">
              <span class="xbm-name">${escapeHtml(tweet.author.name)}</span>
              ${verified}
            </div>
            <span class="xbm-handle">@${escapeHtml(tweet.author.screenName)}</span>
          </div>
          <time class="xbm-time">${formatRelativeDate(tweet.createdAt)}</time>
          <button type="button" class="xbm-remove-btn" data-id="${escapeHtml(tweet.id)}" title="Yer işaretinden çıkar" aria-label="Yer işaretinden çıkar" ${removing ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"/></svg>
          </button>
        </div>
        <div class="xbm-text">${linkifyText(tweet.text)}</div>
        ${tweet.media?.length ? `<div class="xbm-media">${renderMedia(tweet.media)}</div>` : ""}
        ${renderQuoted(tweet.quotedTweet)}
        <div class="xbm-card-actions">
          <a href="${escapeHtml(tweet.url)}" target="_blank" rel="noopener" class="xbm-action-link">Aç</a>
        </div>
      </article>`;
  }

  function renderBookmarksGrid(items) {
    if (!items.length) {
      return `<div class="xbm-empty">
        <p>Henüz yer işareti yok veya aramanızla eşleşen sonuç bulunamadı.</p>
        <p class="xbm-empty-hint">İlk sayfa X tarafından yüklenir. Tümünü almak için alttaki "Tümünü Yükle"ye tıklayın.</p>
      </div>`;
    }

    const groups = groupByMonth(items);
    let html = '<div class="xbm-masonry">';

    for (const [month, tweets] of groups) {
      html += `<h2 class="xbm-month-header">${escapeHtml(month)}</h2>`;
      html += '<div class="xbm-columns">';
      html += tweets.map(renderCard).join("");
      html += "</div>";
    }

    html += "</div>";
    return html;
  }

  function renderAuthorsView(items) {
    const groups = groupByAuthor(items);
    if (!groups.length) {
      return `<div class="xbm-empty"><p>Yazar bulunamadı.</p></div>`;
    }

    let html = '<div class="xbm-authors-grid">';
    for (const group of groups) {
      html += `
        <section class="xbm-author-section">
          <div class="xbm-author-header">
            <img class="xbm-avatar" src="${escapeHtml(group.author.avatarUrl)}" alt="" />
            <div>
              <div class="xbm-name">${escapeHtml(group.author.name)}</div>
              <div class="xbm-handle">@${escapeHtml(group.author.screenName)} · ${group.tweets.length} yer işareti</div>
            </div>
          </div>
          <div class="xbm-columns">${group.tweets.map(renderCard).join("")}</div>
        </section>`;
    }
    html += "</div>";
    return html;
  }

  function renderMainContent() {
    const items = getFilteredBookmarks();
    if (activeTab === "authors") return renderAuthorsView(items);
    return renderBookmarksGrid(items);
  }

  function getLoadLabel() {
    if (!isLoading) return "Tümünü Yükle";
    if (loadAllActive) return `Yükleniyor… (${getDelaySeconds()}s bekleme)`;
    return "Yükleniyor…";
  }

  function renderUI() {
    const count = bookmarks.size;
    const loadingClass = isLoading ? " xbm-loading" : "";
    const hasMore = Boolean(nextCursor);

    return `
      <div class="xbm-app${enabled ? "" : " xbm-disabled"}">
        <header class="xbm-header">
          <div class="xbm-header-left">
            <svg class="xbm-logo" viewBox="0 0 24 24"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </div>
          <div class="xbm-header-center">
            <button type="button" class="xbm-back" aria-label="Geri" onclick="history.back()">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z"/></svg>
            </button>
            <h1 class="xbm-title">Tüm Yer İşaretleri</h1>
            <label class="xbm-toggle" title="Özel görünümü aç/kapat">
              <input type="checkbox" id="xbm-enable-toggle" ${enabled ? "checked" : ""} />
              <span class="xbm-toggle-slider"></span>
            </label>
            <span class="xbm-badge" id="xbm-badge">${count} kayıtlı</span>
          </div>
          <div class="xbm-header-right">
            <button type="button" class="xbm-icon-btn" id="xbm-settings-btn" title="Ayarlar">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.54 1.75h2.92l1.06 2.36 2.44 1.01 2.31-1.35 2.07 2.07-1.35 2.31 1.01 2.44 2.36 1.06v2.92l-2.36 1.06-1.01 2.44 1.35 2.31-2.07 2.07-2.31-1.35-2.44 1.01-1.06 2.36h-2.92l-1.06-2.36-2.44-1.01-2.31 1.35-2.07-2.07 1.35-2.31-1.01-2.44L1.75 13.46v-2.92l2.36-1.06 1.01-2.44L3.77 5.73 5.84 3.66l2.31 1.35 2.44-1.01 1.06-2.36zm1.46 6.25a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>
            </button>
            <button type="button" class="xbm-icon-btn" id="xbm-export-btn" title="JSON olarak dışa aktar">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v12.586l3.293-3.293 1.414 1.414L12 19.414l-4.707-4.707 1.414-1.414L11 15.586V3h1zm-7 14h14v2H5v-2z"/></svg>
            </button>
          </div>
        </header>

        <div class="xbm-toolbar">
          <div class="xbm-search-wrap">
            <svg class="xbm-search-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M10.25 3.75a6.5 6.5 0 1 0 4.13 11.53l4.44 4.44a1 1 0 0 0 1.41-1.41l-4.44-4.44A6.5 6.5 0 0 0 10.25 3.75zm-4.5 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z"/></svg>
            <input type="search" id="xbm-search" class="xbm-search" placeholder="Yer işaretlerinde ara — odaklanmak için /" value="${escapeHtml(searchQuery)}" />
          </div>
          <div class="xbm-tabs">
            <button type="button" class="xbm-tab${activeTab === "bookmarks" ? " active" : ""}" data-tab="bookmarks">Yer İşaretleri</button>
            <button type="button" class="xbm-tab${activeTab === "authors" ? " active" : ""}" data-tab="authors">Yazarlar</button>
          </div>
        </div>

        <main class="xbm-main${loadingClass}" id="xbm-main">
          ${renderMainContent()}
        </main>

        <div class="xbm-bottom-bar">
          <button type="button" class="xbm-bottom-btn" id="xbm-export-bottom" title="JSON dışa aktar">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v12.586l3.293-3.293 1.414 1.414L12 19.414l-4.707-4.707 1.414-1.414L11 15.586V3h1zm-7 14h14v2H5v-2z"/></svg>
            Dışa Aktar
          </button>
          <button type="button" class="xbm-bottom-btn" id="xbm-scroll-load" title="Kalan yer işaretlerini yavaşça yükle" ${!hasMore && !isLoading ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 16l-6-6h12l-6 6zm0 4l-6-6h12l-6 6z"/></svg>
            <span id="xbm-load-label">${getLoadLabel()}</span>
          </button>
        </div>

        <div class="xbm-toast" id="xbm-toast" hidden></div>
      </div>`;
  }

  function showToast(message) {
    const toast = document.getElementById("xbm-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.hidden = true;
    }, 3000);
  }

  function updateLoadingUI() {
    const badge = document.getElementById("xbm-badge");
    const loadLabel = document.getElementById("xbm-load-label");
    const loadBtn = document.getElementById("xbm-scroll-load");
    const main = document.getElementById("xbm-main");

    if (badge) {
      badge.textContent = isLoading
        ? `${bookmarks.size} · yükleniyor…`
        : `${bookmarks.size} kayıtlı`;
    }
    if (loadLabel) {
      loadLabel.textContent = getLoadLabel();
    }
    if (loadBtn) {
      loadBtn.disabled = isLoading || (!nextCursor && !loadAllActive);
    }
    if (main) {
      main.classList.toggle("xbm-loading", isLoading);
    }
  }

  function updateMainContent() {
    const main = document.getElementById("xbm-main");
    if (main) {
      main.innerHTML = renderMainContent();
    }
    updateLoadingUI();
    bindCardEvents();
  }

  function removeBookmarkFromUI(tweetId) {
    bookmarks.delete(tweetId);
    const card = document.querySelector(`.xbm-card[data-id="${tweetId}"]`);
    if (card) {
      card.classList.add("xbm-card-removed");
      setTimeout(() => {
        card.remove();
        updateLoadingUI();
        if (!document.querySelector(".xbm-card")) {
          updateMainContent();
        }
      }, 280);
    } else {
      updateMainContent();
    }
  }

  async function requestRemoveBookmark(tweetId) {
    if (pendingRemoveId) return;
    pendingRemoveId = tweetId;
    updateMainContent();
    showToast("Kaldırılıyor…");

    document.dispatchEvent(
      new CustomEvent("x-bookmarks-remove", { detail: { tweetId } })
    );
  }

  function bindCardEvents() {
    document.querySelectorAll(".xbm-remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id || pendingRemoveId) return;
        requestRemoveBookmark(id);
      });
    });
  }

  function bindEvents() {
    const search = document.getElementById("xbm-search");
    if (search) {
      search.addEventListener("input", (e) => {
        searchQuery = e.target.value;
        updateMainContent();
      });
    }

    document.querySelectorAll(".xbm-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeTab = tab.dataset.tab;
        document.querySelectorAll(".xbm-tab").forEach((t) => {
          t.classList.toggle("active", t.dataset.tab === activeTab);
        });
        updateMainContent();
      });
    });

    const toggle = document.getElementById("xbm-enable-toggle");
    if (toggle) {
      toggle.addEventListener("change", () => {
        enabled = toggle.checked;
        document.body.classList.toggle("xbm-active", enabled);
        if (!enabled) {
          stopLoadAll();
          uiRoot?.remove();
          uiRoot = null;
        } else {
          mountUI();
        }
      });
    }

    document.getElementById("xbm-settings-btn")?.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    document.getElementById("xbm-export-btn")?.addEventListener("click", exportJson);
    document.getElementById("xbm-export-bottom")?.addEventListener("click", exportJson);
    document.getElementById("xbm-scroll-load")?.addEventListener("click", startLoadAll);
  }

  function exportJson() {
    const data = {
      exportedAt: new Date().toISOString(),
      count: bookmarks.size,
      bookmarks: Array.from(bookmarks.values())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((b) => ({
          id: b.id,
          url: b.url,
          text: b.text,
          createdAt: b.createdAt,
          author: b.author,
          media: b.media,
          metrics: b.metrics,
          quotedTweet: b.quotedTweet,
          lang: b.lang,
        })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `x-bookmarks-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${data.count} yer işareti JSON olarak indirildi`);
  }

  function buildNextPageUrl(baseUrl, cursor) {
    if (!baseUrl || !cursor) return null;
    try {
      const url = new URL(baseUrl, window.location.origin);
      const variables = JSON.parse(url.searchParams.get("variables") || "{}");
      variables.cursor = cursor;
      variables.count = variables.count || 20;
      url.searchParams.set("variables", JSON.stringify(variables));
      return url.toString();
    } catch {
      return null;
    }
  }

  function dispatchFetchPage(url) {
    document.dispatchEvent(
      new CustomEvent("x-bookmarks-fetch-page", {
        detail: { url, meta: lastApiMeta },
      })
    );
  }

  function fetchNextPage() {
    if (isFetchingMore || !nextCursor || !lastApiUrl) return false;
    if (seenCursors.has(nextCursor)) {
      nextCursor = null;
      return false;
    }

    const nextUrl = buildNextPageUrl(lastApiUrl, nextCursor);
    if (!nextUrl) return false;

    seenCursors.add(nextCursor);
    isFetchingMore = true;
    isLoading = true;
    updateLoadingUI();

    dispatchFetchPage(nextUrl);
    return true;
  }

  function scheduleAutoFetch() {
    clearTimeout(fetchChainTimer);
    if (!loadAllActive || !nextCursor || isFetchingMore) return;
    if (seenCursors.has(nextCursor)) {
      finishLoadingAll();
      return;
    }

    fetchChainTimer = setTimeout(() => {
      if (!fetchNextPage()) {
        finishLoadingAll();
      }
    }, fetchDelayMs);
  }

  function stopLoadAll() {
    loadAllActive = false;
    isLoading = false;
    isFetchingMore = false;
    clearTimeout(fetchChainTimer);
  }

  function startLoadAll() {
    if (isLoading) return;
    if (!nextCursor) {
      showToast("Yüklenecek başka sayfa yok");
      return;
    }

    loadAllActive = true;
    isLoading = true;
    updateLoadingUI();
    showToast(`Her ${getDelaySeconds()} saniyede bir sayfa yüklenecek`);
    scheduleAutoFetch();
  }

  function finishLoadingAll() {
    const wasLoading = loadAllActive;
    stopLoadAll();
    updateMainContent();

    if (wasLoading && bookmarks.size > 0) {
      showToast(`Toplam ${bookmarks.size} yer işareti yüklendi`);
    }
  }

  function hideNativeUI() {
    document.body.classList.add("xbm-active");
  }

  function mountUI() {
    if (uiRoot) return;
    hideNativeUI();
    uiRoot = document.createElement("div");
    uiRoot.id = "x-bookmarks-manager-root";
    uiRoot.innerHTML = renderUI();
    document.body.appendChild(uiRoot);
    bindEvents();
    bindCardEvents();
  }

  function handleBookmarkData(payload, url, meta) {
    if (url) lastApiUrl = url;
    if (meta) lastApiMeta = meta;

    const { tweets, cursor } = XBookmarksParser.parseBookmarkResponse(payload);
    mergeBookmarks(tweets);

    if (cursor) {
      nextCursor = cursor;
    } else {
      nextCursor = null;
    }

    isFetchingMore = false;

    if (uiRoot) updateMainContent();

    if (loadAllActive) {
      if (nextCursor && !seenCursors.has(nextCursor)) {
        isLoading = true;
        updateLoadingUI();
        scheduleAutoFetch();
      } else {
        finishLoadingAll();
      }
    } else {
      isLoading = false;
      updateLoadingUI();
    }
  }

  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        document.getElementById("xbm-search")?.focus();
      }
    });
  }

  function waitForBody() {
    return new Promise((resolve) => {
      if (document.body) return resolve();
      const obs = new MutationObserver(() => {
        if (document.body) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(document.documentElement, { childList: true });
    });
  }

  async function init() {
    injectScript();
    await loadSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes[SETTINGS_KEY]) return;
      fetchDelayMs =
        clampDelaySeconds(changes[SETTINGS_KEY].newValue) * 1000;
      updateLoadingUI();
    });

    document.addEventListener("x-bookmarks-extension", (e) => {
      const { type, payload, url, meta } = e.detail || {};

      if (type === "bookmarks-data") {
        handleBookmarkData(payload, url, meta);
        if (!uiRoot && enabled) mountUI();
      }

      if (type === "fetch-error") {
        isFetchingMore = false;
        if (loadAllActive) {
          finishLoadingAll();
          showToast("Yükleme durdu — kısmi liste mevcut");
        } else {
          isLoading = false;
          updateLoadingUI();
        }
      }

      if (type === "bookmark-removed" && e.detail?.tweetId) {
        pendingRemoveId = null;
        removeBookmarkFromUI(e.detail.tweetId);
        showToast("Yer işaretinden çıkarıldı");
      }

      if (type === "remove-error") {
        pendingRemoveId = null;
        updateMainContent();
        showToast(e.detail?.message || "Kaldırılamadı");
      }

      if (type === "ready") {
        waitForBody().then(() => {
          setTimeout(() => {
            if (!uiRoot && enabled) mountUI();
          }, 2500);
        });
      }
    });

    await waitForBody();
    setTimeout(() => {
      if (!uiRoot && enabled) mountUI();
    }, 4000);
    initKeyboardShortcuts();
  }

  init();
})();
