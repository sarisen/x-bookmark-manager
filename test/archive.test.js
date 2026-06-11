const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadArchive() {
  const context = {
    window: {},
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get() {},
          set() {},
        },
      },
    },
    Date,
    Error,
    Map,
    Promise,
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../content/archive.js"),
    "utf8"
  );
  vm.runInNewContext(source, context);
  return context.window.XBookmarksArchive;
}

test("merge preserves the first observed bookmark time", () => {
  const archive = loadArchive();
  const firstSeen = "2026-06-01T10:00:00.000Z";
  const secondSeen = "2026-06-08T10:00:00.000Z";

  const initial = archive.merge([], [{ id: "1", text: "old" }], firstSeen);
  const updated = archive.merge(
    initial,
    [{ id: "1", text: "new" }],
    secondSeen
  );

  assert.equal(updated.length, 1);
  assert.equal(updated[0].text, "new");
  assert.equal(updated[0].bookmarkedAt, firstSeen);
  assert.equal(updated[0].lastSeenAt, secondSeen);
});

test("export is versioned and sorted by bookmark observation time", () => {
  const archive = loadArchive();
  const output = archive.createExport(
    [
      { id: "1", bookmarkedAt: "2026-06-01T10:00:00.000Z" },
      { id: "2", bookmarkedAt: "2026-06-10T10:00:00.000Z" },
    ],
    {},
    "2026-06-11T10:00:00.000Z"
  );

  assert.equal(output.schemaVersion, 1);
  assert.equal(output.source, "x-bookmark-manager");
  assert.equal(output.count, 2);
  assert.deepEqual(
    Array.from(output.bookmarks, (bookmark) => bookmark.id),
    ["2", "1"]
  );
});

test("export can include only the requested rolling period", () => {
  const archive = loadArchive();
  const output = archive.createExport(
    [
      { id: "old", bookmarkedAt: "2026-05-01T10:00:00.000Z" },
      { id: "new", bookmarkedAt: "2026-06-10T10:00:00.000Z" },
    ],
    { days: 7 },
    "2026-06-11T10:00:00.000Z"
  );

  assert.equal(output.count, 1);
  assert.equal(output.bookmarks[0].id, "new");
  assert.equal(output.range.days, 7);
});

test("rolling export uses tweet date when the archive was first seen today", () => {
  const archive = loadArchive();
  const output = archive.createExport(
    [
      {
        id: "old-tweet",
        createdAt: "2026-01-01T10:00:00.000Z",
        bookmarkedAt: "2026-06-11T09:00:00.000Z",
      },
      {
        id: "new-tweet",
        createdAt: "2026-06-10T10:00:00.000Z",
        bookmarkedAt: "2026-06-11T09:00:00.000Z",
      },
    ],
    { days: 30 },
    "2026-06-11T10:00:00.000Z"
  );

  assert.equal(output.count, 1);
  assert.equal(output.bookmarks[0].id, "new-tweet");
  assert.equal(output.range.dateField, "createdAt");
});

test("custom export includes both boundary dates", () => {
  const archive = loadArchive();
  const output = archive.createExport(
    [
      { id: "before", createdAt: "2026-05-31T23:59:59.999Z" },
      { id: "start", createdAt: "2026-06-01T00:00:00.000Z" },
      { id: "end", createdAt: "2026-06-05T23:59:59.999Z" },
      { id: "after", createdAt: "2026-06-06T00:00:00.000Z" },
    ],
    {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-05T23:59:59.999Z",
    },
    "2026-06-11T10:00:00.000Z"
  );

  assert.deepEqual(
    Array.from(output.bookmarks, (bookmark) => bookmark.id),
    ["end", "start"]
  );
  assert.equal(output.range.type, "custom");
});
