import assert from "node:assert/strict";
import test from "node:test";
import {
  equivalentTxContracts,
  excelRound,
  getTaifexFutures,
  parseForeignNetPositions,
} from "../lib/taifex.ts";

const products = ["臺股期貨", "小型臺指期貨", "微型臺指期貨"];

function cells(values) {
  return values.map((value) => `<td>${value}</td>`).join("");
}

function reportHtml(values, report) {
  const figures = report === "full-day" ? 12 : 6;
  const netIndex = report === "full-day" ? 10 : 4;
  const rows = products.flatMap((product, productIndex) => {
    const dealer = Array(figures).fill(0);
    const trust = Array(figures).fill(0);
    const foreign = Array(figures).fill(0);
    foreign[netIndex] = values[product];
    return [
      `<tr>${cells([productIndex + 1, product, "自營商", ...dealer])}</tr>`,
      `<tr>${cells(["投信", ...trust])}</tr>`,
      `<tr>${cells(["外資", ...foreign])}</tr>`,
    ];
  });
  return `<html><body><table>${rows.join("")}</table></body></html>`;
}

test("parses full-day foreign open-interest net positions", () => {
  const parsed = parseForeignNetPositions(
    reportHtml(
      { 臺股期貨: -74081, 小型臺指期貨: 5667, 微型臺指期貨: 13703 },
      "full-day",
    ),
    "full-day",
  );
  assert.deepEqual(parsed, {
    臺股期貨: -74081,
    小型臺指期貨: 5667,
    微型臺指期貨: 13703,
  });
});

test("uses Excel-style rounding and contract multipliers", () => {
  assert.equal(excelRound(1.5), 2);
  assert.equal(excelRound(-1.5), -2);
  assert.equal(
    equivalentTxContracts({ 臺股期貨: -74081, 小型臺指期貨: 5667, 微型臺指期貨: 13703 }),
    -71979,
  );
});

test("keeps the first interpretation blank and calculates the next trading day", async () => {
  const fixtures = {
    "2026-09-21": {
      full: { 臺股期貨: -74081, 小型臺指期貨: 5667, 微型臺指期貨: 13703 },
      night: { 臺股期貨: -1196, 小型臺指期貨: -2746, 微型臺指期貨: -6177 },
    },
    "2026-09-22": {
      full: { 臺股期貨: -75568, 小型臺指期貨: 3156, 微型臺指期貨: 2682 },
      night: { 臺股期貨: 255, 小型臺指期貨: 5, 微型臺指期貨: -547 },
    },
  };

  const mockFetch = async (input) => {
    const url = new URL(String(input));
    const date = url.searchParams.get("queryDate")?.replaceAll("/", "-");
    const fixture = fixtures[date];
    assert.ok(fixture, `missing fixture for ${date}`);
    const report = url.pathname.endsWith("DateAh") ? "night" : "full-day";
    const values = report === "night" ? fixture.night : fixture.full;
    return new Response(reportHtml(values, report), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };

  const response = await getTaifexFutures(
    "2026-09-21",
    "2026-09-22",
    mockFetch,
  );

  assert.equal(response.data.length, 2);
  assert.deepEqual(response.data[0], {
    date: "2026-09-21",
    txNetOpenInterest: -74081,
    mtxNetOpenInterest: 5667,
    tmfNetOpenInterest: 13703,
    officialEquivalentNetOi: -71979,
    totalPositionChange: null,
    nightEquivalentNet: -2192,
    pureDayChange: null,
    interpretation: null,
  });
  assert.equal(response.data[1].officialEquivalentNetOi, -74645);
  assert.equal(response.data[1].totalPositionChange, -2666);
  assert.equal(response.data[1].nightEquivalentNet, 229);
  assert.equal(response.data[1].pureDayChange, -2895);
  assert.equal(response.data[1].interpretation, "偏空");
});
