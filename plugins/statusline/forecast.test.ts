import assert from "node:assert/strict";
import test from "node:test";
import { forecastDetails, projectedUsage } from "./forecast.ts";

const HOUR = 60 * 60 * 1_000;
const START = Date.parse("2026-11-16T00:00:00Z");
function quota(kind = "five-hour", usedPercent = 60, hours = 5) {
  return { kind, usedPercent, resetsAt: new Date(START + hours * HOUR).toISOString() };
}

test("60% spent halfway through each known period projects 120%", () => {
  for (const [kind, hours] of [["five-hour", 5], ["daily", 24], ["weekly", 168]] as const) {
    const at = START + hours * HOUR / 2;
    assert.equal(projectedUsage(quota(kind, 60, hours), at, at), 120);
  }
});

test("half the allowance halfway through the period reaches exactly 100%", () => {
  const at = START + 2.5 * HOUR;
  assert.equal(projectedUsage(quota("five-hour", 50), at, at), 100);
  assert.equal(projectedUsage(quota("five-hour", 20), at, at), 40);
  assert.equal(projectedUsage(quota("five-hour", 0), at, at), 0);
});

test("uses the measurement time so rereading cached data does not change its pace", () => {
  const at = START + 2.5 * HOUR;
  assert.equal(projectedUsage(quota(), at, at + HOUR), 120);
});

test("unknown periods and missing or invalid timings have no forecast", () => {
  const at = START + HOUR;
  for (const kind of [undefined, "custom", "monthly", "toString"]) {
    assert.equal(projectedUsage({ ...quota(), kind }, at, at), null);
  }
  for (const resetsAt of [null, "invalid"]) {
    assert.equal(projectedUsage({ ...quota(), resetsAt }, at, at), null);
  }
  for (const observedAt of [null, NaN, Infinity, at + 1, START, START - 1]) {
    assert.equal(projectedUsage(quota(), observedAt, at), null);
  }
});

test("suppresses expired windows and invalid usage", () => {
  const at = START + 2.5 * HOUR;
  assert.equal(projectedUsage(quota(), at, START + 5 * HOUR), null);
  assert.equal(projectedUsage(quota(), at, START + 6 * HOUR), null);
  for (const usedPercent of [-1, NaN, Infinity]) {
    assert.equal(projectedUsage(quota("five-hour", usedPercent), at, at), null);
  }
});

test("tooltip states the total forecast and the excess as a share of the allowance", () => {
  assert.equal(forecastDetails(120), "Forecast at reset: ~120% used (average pace since this period started).\nExpected excess: ~20% of the allowance.");
  assert.doesNotMatch(forecastDetails(100), /excess/);
  assert.match(forecastDetails(100.001), /~100.1%.*\nExpected excess: ~0.1%/);
});
