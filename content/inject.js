(function () {
  if (window.__xBookmarksInjected) return;
  window.__xBookmarksInjected = true;

  const BOOKMARK_QUERIES = [
    "Bookmarks",
    "bookmark_timeline",
    "BookmarkTimeline",
    "BookmarkSearchTimeline",
  ];

  let lastBookmarkMeta = null;
  let pendingRemove = null;

  function isBookmarkRequest(url) {
    if (!url || typeof url !== "string") return false;
    const lower = url.toLowerCase();
    return BOOKMARK_QUERIES.some((q) => lower.includes(q.toLowerCase()));
  }

  function isDeleteBookmarkRequest(url) {
    return typeof url === "string" && /\/DeleteBookmark/i.test(url);
  }

  function dispatch(type, detail) {
    document.dispatchEvent(
      new CustomEvent("x-bookmarks-extension", {
        detail: { type, ...detail },
      })
    );
  }

  function sanitizeHeaders(headers) {
    const forbidden = new Set([
      "host",
      "connection",
      "content-length",
      "cookie",
      "accept-encoding",
    ]);
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (!forbidden.has(key.toLowerCase()) && value) {
        out[key] = value;
      }
    }
    return out;
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) return out;
    if (headers instanceof Headers) {
      headers.forEach((v, k) => {
        out[k] = v;
      });
      return sanitizeHeaders(out);
    }
    if (typeof headers === "object") {
      return sanitizeHeaders({ ...headers });
    }
    return out;
  }

  function parseBody(body) {
    if (!body) return null;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
    return body;
  }

  function saveBookmarkMeta(url, headers) {
    lastBookmarkMeta = {
      url,
      headers: headersToObject(headers),
    };
  }

  function handlePayload(payload, source, url, meta) {
    if (!payload) return;
    if (meta) lastBookmarkMeta = meta;
    else if (url && lastBookmarkMeta) lastBookmarkMeta.url = url;

    dispatch("bookmarks-data", {
      payload,
      source,
      url: url || lastBookmarkMeta?.url,
      meta: lastBookmarkMeta,
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function simulateClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    };

    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...base, button: 0 }));
    if (typeof el.click === "function") el.click();
  }

  function findTweetById(tweetId) {
    const id = String(tweetId);

    for (const tweet of document.querySelectorAll('[data-testid="tweet"]')) {
      const link = tweet.querySelector(`a[href*="/status/${id}"]`);
      if (link) return tweet;
    }

    const link = document.querySelector(`a[href*="/status/${id}"]`);
    return link?.closest('[data-testid="tweet"]') || null;
  }

  function findBookmarkButton(tweetEl) {
    const selectors = [
      '[data-testid="unbookmark"]',
      '[data-testid="removeBookmark"]',
      '[data-testid="bookmark"]',
    ];

    for (const sel of selectors) {
      const node = tweetEl.querySelector(sel);
      if (node) return node.closest("button") || node;
    }

    for (const btn of tweetEl.querySelectorAll("button")) {
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (
        label.includes("bookmark") ||
        label.includes("yer işareti")
      ) {
        return btn;
      }
    }

    const groups = tweetEl.querySelectorAll('[role="group"]');
    for (const group of groups) {
      for (const btn of group.querySelectorAll("button")) {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes("bookmark") || label.includes("yer işareti")) {
          return btn;
        }
      }
    }

    return null;
  }

  function getScrollRoots() {
    const roots = new Set();
    const column = document.querySelector('[data-testid="primaryColumn"]');
    if (column) {
      roots.add(column);
      column.querySelectorAll("*").forEach((el) => {
        const s = getComputedStyle(el);
        if (
          (s.overflowY === "auto" || s.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 10
        ) {
          roots.add(el);
        }
      });
    }
    if (document.scrollingElement) roots.add(document.scrollingElement);
    return [...roots];
  }

  async function scrollUntilTweet(tweetId, maxMs = 15000) {
    const deadline = Date.now() + maxMs;
    const roots = getScrollRoots();

    while (Date.now() < deadline) {
      const found = findTweetById(tweetId);
      if (found) return found;

      for (const root of roots) {
        root.scrollTop = Math.min(
          root.scrollTop + 500,
          root.scrollHeight
        );
      }
      await sleep(450);
    }

    return findTweetById(tweetId);
  }

  function waitForDeleteConfirm(tweetId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingRemove?.tweetId === tweetId) pendingRemove = null;
        reject(new Error("X yanıt vermedi"));
      }, timeoutMs);

      pendingRemove = {
        tweetId: String(tweetId),
        resolve: () => {
          clearTimeout(timer);
          pendingRemove = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          pendingRemove = null;
          reject(err);
        },
      };
    });
  }

  function noteDeleteFromRequest(body) {
    if (!pendingRemove) return;
    const parsed = parseBody(body);
    const tid =
      parsed?.variables?.tweet_id ||
      parsed?.variables?.tweetId ||
      null;
    if (tid && String(tid) === pendingRemove.tweetId) {
      pendingRemove.resolve();
    }
  }

  async function removeBookmarkViaDom(tweetId) {
    let tweetEl = findTweetById(tweetId);

    if (!tweetEl) {
      tweetEl = await scrollUntilTweet(tweetId);
    }

    if (!tweetEl) {
      throw new Error("Tweet X listesinde bulunamadı");
    }

    const btn = findBookmarkButton(tweetEl);
    if (!btn) {
      throw new Error("Yer işareti butonu bulunamadı");
    }

    tweetEl.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(200);

    const confirmPromise = waitForDeleteConfirm(tweetId, 8000);
    simulateClick(btn);

    await confirmPromise.catch(async () => {
      await sleep(800);
      if (!findTweetById(tweetId)) return;
      throw new Error("Kaldırılamadı — tekrar deneyin");
    });
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    let url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const init = args[1] || {};
    let headers = init.headers;
    let body = init.body;

    if (args[0] instanceof Request) {
      headers = args[0].headers;
      if (args[0].method !== "GET") {
        try {
          body = await args[0].clone().text();
        } catch (_) {}
      }
    }

    if (isDeleteBookmarkRequest(url)) {
      noteDeleteFromRequest(body);
    }

    if (isBookmarkRequest(url)) {
      saveBookmarkMeta(url, headers);
    }

    const response = await originalFetch(...args);

    try {
      if (isBookmarkRequest(url)) {
        const clone = response.clone();
        clone
          .json()
          .then((data) =>
            handlePayload(data, "fetch", url, lastBookmarkMeta)
          )
          .catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  const XHROpen = XMLHttpRequest.prototype.open;
  const XHRSend = XMLHttpRequest.prototype.send;
  const XHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__xBookmarkUrl = url;
    this.__xBookmarkHeaders = {};
    this.__xBookmarkBody = null;
    return XHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (!this.__xBookmarkHeaders) this.__xBookmarkHeaders = {};
    this.__xBookmarkHeaders[name] = value;
    return XHRSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.__xBookmarkBody = args[0] || null;

    if (isDeleteBookmarkRequest(this.__xBookmarkUrl)) {
      noteDeleteFromRequest(this.__xBookmarkBody);
    }

    this.addEventListener("load", function () {
      try {
        if (isBookmarkRequest(this.__xBookmarkUrl) && this.responseText) {
          saveBookmarkMeta(this.__xBookmarkUrl, this.__xBookmarkHeaders);
          handlePayload(
            JSON.parse(this.responseText),
            "xhr",
            this.__xBookmarkUrl,
            lastBookmarkMeta
          );
        }
      } catch (_) {}
    });
    return XHRSend.apply(this, args);
  };

  document.addEventListener("x-bookmarks-fetch-page", async (e) => {
    const { url, meta } = e.detail || {};
    const requestUrl = url || meta?.url || lastBookmarkMeta?.url;
    const requestHeaders = sanitizeHeaders(
      meta?.headers || lastBookmarkMeta?.headers || {}
    );

    if (!requestUrl) {
      dispatch("fetch-error", { message: "API URL bulunamadı" });
      return;
    }

    try {
      const response = await originalFetch(requestUrl, {
        method: "GET",
        credentials: "include",
        headers: requestHeaders,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      handlePayload(data, "fetch-page", requestUrl, {
        url: requestUrl,
        headers: requestHeaders,
      });
    } catch (err) {
      dispatch("fetch-error", { message: err.message || "Fetch failed" });
    }
  });

  document.addEventListener("x-bookmarks-remove", async (e) => {
    const { tweetId } = e.detail || {};
    if (!tweetId) {
      dispatch("remove-error", { tweetId, message: "Tweet ID yok" });
      return;
    }

    try {
      await removeBookmarkViaDom(tweetId);
      dispatch("bookmark-removed", { tweetId });
    } catch (err) {
      dispatch("remove-error", {
        tweetId,
        message: err.message || "Kaldırılamadı",
      });
    }
  });

  dispatch("ready", {});
})();
