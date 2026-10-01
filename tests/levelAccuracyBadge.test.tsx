import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { LevelAccuracyBadge } from "../components/trade/LevelAccuracyBadge";
import type { ChartDrawing } from "../services/trade/chartDrawings";
import type { Kline } from "../types";

/**
 * The measurement finally reaches the user.
 *
 * `levelAccuracy` shipped MODEL-facing: the seat is told its own standing in the
 * receipt of its next draw. The user never saw it. That made a real number
 * invisible to the one person who could act on it — "this seat draws levels the
 * market ignores" is something you fix by switching model, and you cannot know
 * that without seeing the figure.
 *
 * Two things these tests pin that the model-facing side already learned:
 *
 * 1. SILENCE over "0 of 0". A badge reading 0% when nothing has been judged
 *    reports a failing model when the truth is an empty sample.
 * 2. Session-scoped, not per-model — because `ChartDrawing` carries no seat
 *    stamp. That is a data limitation, asserted here so the badge cannot quietly
 *    grow a per-model label that has nothing to group by.
 */

const hline = (price: number, createdAt: number): ChartDrawing => ({
  id: `d-${price}-${createdAt}`,
  kind: "hline",
  points: [{ t: 1_700_000_000, p: price }],
  color: "#399ef7",
  createdAt,
});

/** Flat market at 100 for 10 bars. */
const flat = (n = 10): Kline[] =>
  Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }));

describe("LevelAccuracyBadge", () => {
  it("renders nothing when there are no model drawings", () => {
    const { container } = render(<LevelAccuracyBadge drawings={[]} candles={flat()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while every level is too young to judge", () => {
    // Drawn just now, with only TWO bars since — below the minimum of three.
    // Reporting 0% here would blame the model for a level the market has had
    // no chance to reach. The first version of this fixture supplied five bars
    // and therefore tested nothing: five is judgeable.
    const now = Date.now();
    const bars = flat(2).map((b, i) => ({
      ...b,
      time: Math.floor(now / 1000) + i * 60,
    }));
    const { container } = render(
      <LevelAccuracyBadge drawings={[hline(100, now)]} candles={bars} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing without candles", () => {
    const drawnAt = Date.now() - 3_600_000;
    const { container } = render(
      <LevelAccuracyBadge drawings={[hline(100, drawnAt)]} candles={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the share of drawn levels price actually reached", () => {
    // The last bar spans 95-130, so it contains BOTH the 100 and the 120 level.
    // The drawnAt is an hour ago, so every bar counts — judgeable, not pending.
    const drawnAt = Date.now() - 3_600_000;
    const bars = flat(10).map((b) => ({
      ...b,
      time: Math.floor(drawnAt / 1000) + b.time - 1_700_000_000,
    }));
    bars[9] = { ...bars[9], high: 130, low: 95 };
    const { container } = render(
      <LevelAccuracyBadge
        drawings={[hline(100, drawnAt), hline(120, drawnAt)]}
        candles={bars}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId("level-accuracy-badge").textContent).toMatch(/100%/);
    expect(screen.getByTestId("level-accuracy-badge").textContent).toMatch(/2\/2/);
  });

  it("reports a level the market never came back to", () => {
    // Drawn an hour ago, every bar far below it. This is the number that
    // tells a user the seat is inventing levels — the whole reason the
    // measurement is on screen at all.
    const drawnAt = Date.now() - 3_600_000;
    const bars = flat(10).map((b) => ({
      ...b,
      time: Math.floor(drawnAt / 1000) + b.time - 1_700_000_000,
      high: 50,
      low: 40,
    }));
    render(<LevelAccuracyBadge drawings={[hline(100, drawnAt)]} candles={bars} />);
    expect(screen.getByTestId("level-accuracy-badge").textContent).toMatch(/0%/);
    expect(screen.getByTestId("level-accuracy-badge").textContent).toMatch(/0\/1/);
  });

  it("ignores shapes that are not horizontal levels", () => {
    // A trendline has no single price to have been reached. Scoring it against
    // points[0] would be measuring a price the shape does not claim.
    //
    // The candles are built AFTER the drawing time on purpose. The first
    // version used a fixed epoch that fell BEFORE `drawnAt`, so the series was
    // all "pending" and the badge rendered null whichever way the filter went
    // - the test passed while scoring trends would have broken it. Reverting
    // the filter to accept any shape left this file 7/7 green.
    const drawnAt = Date.now() - 3_600_000;
    const bars = flat(10).map((b) => ({
      ...b,
      time: Math.floor(drawnAt / 1000) + b.time - 1_700_000_000,
    }));
    const trend: ChartDrawing = {
      id: "t1",
      kind: "trend",
      points: [
        { t: Math.floor(drawnAt / 1000) + 60, p: 100 },
        { t: Math.floor(drawnAt / 1000) + 300, p: 120 },
      ],
      color: "#399ef7",
      createdAt: drawnAt,
    };
    const { container } = render(<LevelAccuracyBadge drawings={[trend]} candles={bars} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("the data limitation is stated, not worked around", () => {
  it("ChartDrawing still carries no seat stamp", async () => {
    // #16 (per-model drawing layers) is a SCHEMA change because of this. A
    // badge that claimed per-model accuracy would be grouping by nothing.
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chartDrawings.ts", "utf8");
    const block = src.slice(src.indexOf("export interface ChartDrawing"));
    const head = block.slice(0, block.indexOf("}"));
    expect(head).not.toMatch(/botId|seatId|modelId|providerId/);
  });
});
