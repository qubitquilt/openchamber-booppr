import { test } from "node:test";
import assert from "node:assert/strict";

import {
  linksForPR,
  pruneSessionLinks,
  sanitizeSessionLinks,
  SESSION_LINKS_MAX,
} from "../build/session-links.mjs";

test("sanitizeSessionLinks reads well-formed entries and drops junk", () => {
  const links = sanitizeSessionLinks({
    ses_1: { pr: "o/r#1", title: "T", at: 10, posted: ["started"], outcomeAt: 20 },
    ses_2: { title: "no pr" },
    ses_3: null,
    junk: "string",
  });
  assert.deepEqual(links, {
    ses_1: { pr: "o/r#1", title: "T", at: 10, posted: ["started"], outcomeAt: 20 },
  });
  assert.deepEqual(sanitizeSessionLinks(null), {});
  assert.deepEqual(sanitizeSessionLinks("junk"), {});
});

test("pruneSessionLinks keeps the newest by start time", () => {
  const links = {
    a: { pr: "o/r#1", title: "", at: 1, posted: [] },
    b: { pr: "o/r#2", title: "", at: 3, posted: [] },
    c: { pr: "o/r#3", title: "", at: 2, posted: [] },
  };
  const kept = pruneSessionLinks(links, 2);
  assert.deepEqual(Object.keys(kept), ["b", "c"]);
});

test("pruneSessionLinks keeps at most SESSION_LINKS_MAX", () => {
  const links = {};
  for (let index = 0; index < SESSION_LINKS_MAX + 10; index += 1) {
    links[`ses_${index}`] = { pr: "o/r#1", title: "", at: index, posted: [] };
  }
  assert.equal(Object.keys(pruneSessionLinks(links)).length, SESSION_LINKS_MAX);
});

test("linksForPR filters and sorts newest first", () => {
  const links = {
    a: { pr: "o/r#1", title: "old", at: 1, posted: [] },
    b: { pr: "o/r#1", title: "new", at: 5, posted: [] },
    c: { pr: "o/r#2", title: "", at: 9, posted: [] },
  };
  const matched = linksForPR(links, "o/r#1");
  assert.deepEqual(
    matched.map(([id]) => id),
    ["b", "a"],
  );
});
