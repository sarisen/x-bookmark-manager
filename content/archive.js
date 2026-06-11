/* global window, chrome */
(function () {
  "use strict";

  const STORAGE_KEY = "bookmarkArchiveV1";
  const SCHEMA_VERSION = 1;

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result[key]);
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: value }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function normalizeBookmark(bookmark, seenAt) {
    if (!bookmark?.id) return null;
    return {
      ...bookmark,
      id: String(bookmark.id),
      bookmarkedAt: bookmark.bookmarkedAt || seenAt,
      lastSeenAt: seenAt,
    };
  }

  async function load() {
    const archive = await storageGet(STORAGE_KEY);
    if (!archive || archive.schemaVersion !== SCHEMA_VERSION) return [];
    return Array.isArray(archive.bookmarks) ? archive.bookmarks : [];
  }

  async function save(bookmarks) {
    const now = new Date().toISOString();
    await storageSet({
      schemaVersion: SCHEMA_VERSION,
      updatedAt: now,
      count: bookmarks.length,
      bookmarks,
    });
  }

  function merge(existing, incoming, seenAt = new Date().toISOString()) {
    const merged = new Map();

    for (const bookmark of existing || []) {
      const normalized = normalizeBookmark(bookmark, bookmark.lastSeenAt || seenAt);
      if (normalized) merged.set(normalized.id, normalized);
    }

    for (const bookmark of incoming || []) {
      const normalized = normalizeBookmark(bookmark, seenAt);
      if (!normalized) continue;
      const previous = merged.get(normalized.id);
      merged.set(normalized.id, {
        ...previous,
        ...normalized,
        bookmarkedAt: previous?.bookmarkedAt || normalized.bookmarkedAt,
      });
    }

    return Array.from(merged.values());
  }

  function getBookmarkDate(bookmark) {
    return bookmark.bookmarkedAt || bookmark.createdAt || null;
  }

  function createExport(
    bookmarks,
    options = {},
    exportedAt = new Date().toISOString()
  ) {
    const days = Number.isFinite(options.days) ? options.days : null;
    const cutoff = days
      ? new Date(exportedAt).getTime() - days * 24 * 60 * 60 * 1000
      : null;
    const filtered = bookmarks.filter((bookmark) => {
      if (!cutoff) return true;
      const date = getBookmarkDate(bookmark);
      return date && new Date(date).getTime() >= cutoff;
    });
    const sorted = [...filtered].sort(
      (a, b) =>
        new Date(getBookmarkDate(b) || 0) -
        new Date(getBookmarkDate(a) || 0)
    );

    return {
      schemaVersion: SCHEMA_VERSION,
      source: "x-bookmark-manager",
      exportedAt,
      range: days
        ? {
            type: "rolling",
            days,
            since: new Date(cutoff).toISOString(),
            dateField: "bookmarkedAt",
            fallbackDateField: "createdAt",
          }
        : { type: "all" },
      count: sorted.length,
      bookmarks: sorted,
    };
  }

  window.XBookmarksArchive = {
    load,
    save,
    merge,
    createExport,
  };
})();
