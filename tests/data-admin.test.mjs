import assert from "node:assert/strict";
import test from "node:test";
import { parseDataTargets } from "../lib/data-admin.ts";

test("parseDataTargets expands all to every data table", () => {
  assert.deepEqual(parseDataTargets("all"), ["spot", "night", "day"]);
});

test("parseDataTargets accepts comma lists in a fixed order without duplicates", () => {
  assert.deepEqual(parseDataTargets("day,night,day"), ["night", "day"]);
  assert.deepEqual(parseDataTargets(" spot "), ["spot"]);
});

test("parseDataTargets rejects missing or unknown names so nothing unintended is cleared", () => {
  assert.equal(parseDataTargets(undefined), null);
  assert.equal(parseDataTargets(""), null);
  assert.equal(parseDataTargets("night,users"), null);
  assert.equal(parseDataTargets("telegram_recipients"), null);
  assert.equal(parseDataTargets("toString"), null);
});
