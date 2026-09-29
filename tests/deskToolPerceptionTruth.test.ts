import { describe, it, expect } from "vitest";

/**
 * What the model is TOLD it can see must match what it is actually SENT.
 *
 * Both defects below were the same class of lie, and both shipped: the tool
 * advertised "the last 60 candles" while a 2400-char budget cut it to ~37 with
 * nothing marking the loss, and the prompt insisted the packet "carries EIGHT
 * candles per timeframe" for a surface that ships none. In a repo whose whole
 * harnessMarks doctrine exists so the model is never told it holds evidence it
 * does not, both are load-bearing.
 *
 * These assertions are about the CONFIGURATION, not the output, so they hold
 * without a network: a budget is a constant, a tool list is an array, and a
 * prompt is a string. Each was proven by removing the fix and watching the
 * matching assertion go red.
 */

describe("get_chart_view is not silently truncated", () => {
  it("has a budget that holds a full 60-candle read", async () => {
    const { budgetToolContent } = await import(
      "../services/analysis/DeskToolsService"
    );

    // A realistic six-figure OHLCV row, exactly as the tool formats it
    // (`<slice(5,16)> O.. H.. L.. C.. V..`, 64 chars measured on BTC).
    const row =
      "09-28T14:30 O104523.12 H104611.80 L104498.55 C104578.90 V12.4821";
    const sixtyRows = Array.from({ length: 60 }, () => row).join("\n");

    // The tool's own description promises this many candles, so the budget has
    // to hold them. Before the fix this clipped at the 2400-char default and
    // the seat read ~37 of 60 while believing it had all of them.
    expect(sixtyRows.length).toBeGreaterThan(3840);

    const budgeted = budgetToolContent("get_chart_view", sixtyRows);
    // Either it fits whole, or it is clipped AND says so.
    const complete = budgeted === sixtyRows;
    const admittedLoss =
      /MISSING|clipped|spill|read_tool_output/i.test(budgeted);
    expect(complete || admittedLoss).toBe(true);
    // The whole point: it fits.
    expect(budgeted).toBe(sixtyRows);
  });
});

describe("the Chart AI dock can recover a clipped result", () => {
  it("exposes read_tool_output, which is what makes the spill receipt honest", async () => {
    const { spillReceiptAllowed } = await import(
      "../services/analysis/DeskToolsService"
    );

    // Mirrors TRADE_TOOLS in services/trade/chatTurnRunner.ts. The receipt is
    // only offered to seats that can actually call the tool it names; without
    // it the dock suppressed the receipt AND had no way to fetch the rest, so
    // a clipped chart read was unrecoverable AND silent.
    const DOCK_TOOLS = [
      "get_price_snapshot",
      "get_order_book",
      "get_market_packet",
      "get_all_timeframes",
      "get_chart_view",
      "recall",
      "web_search",
      "scan_setups",
      "run_screener",
      "draw_on_chart",
      "mark_trade_levels",
      "read_tool_output",
    ];

    expect(DOCK_TOOLS).toContain("read_tool_output");
    expect(spillReceiptAllowed(DOCK_TOOLS)).toBe(true);

    // And the negative still holds: an allow-list without it gets no promise.
    expect(spillReceiptAllowed(["get_market_packet"])).toBe(false);
  });

  it("keeps the dock's real tool list in step with this test", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");
    const block = /const TRADE_TOOLS = \[([\s\S]*?)\n\];/.exec(src);
    expect(block).not.toBeNull();
    const names = [...(block?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1]!
    );
    // The real list, not a copy that can drift.
    expect(names).toContain("read_tool_output");
    expect(names).toContain("get_chart_view");
  });
});

describe("the desk-tools prompt does not promise evidence it does not send", () => {
  it("does not assert a fixed candle count for every surface", async () => {
    const { DESK_TOOLS_PROMPT } = await import(
      "../services/analysis/DeskToolsService"
    );

    // The compact packet drops the OHLC blocks outright
    // (HybridIntelligenceService: `options?.compact ? '' : ohlcBlocks`), so a
    // prompt asserting "EIGHT candles per timeframe" tells the model it holds
    // eight rows on a surface where it holds none.
    expect(DESK_TOOLS_PROMPT).not.toMatch(
      /carries EIGHT candles per timeframe plus/
    );
    // The scolding must survive the correction, or the fix removed the
    // warning along with the false claim.
    expect(DESK_TOOLS_PROMPT).toMatch(/get_chart_view/);
    expect(DESK_TOOLS_PROMPT).toMatch(/compact/i);
    expect(DESK_TOOLS_PROMPT).toMatch(/invented, not read/);
  });

  it("pins the compact flag to actually dropping the rows", async () => {
    // The prompt is only honest while this holds. Asserted against the SOURCE
    // rather than a synthetic packet: building a valid one needs the full
    // hybrid payload, and a fabricated shape would only prove that the
    // function tolerates nonsense.
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "services/analysis/HybridIntelligenceService.ts",
      "utf8"
    );
    expect(src).toMatch(/options\?\.compact \? '' : ohlcBlocks/);
    expect(src).toMatch(/if \(!options\?\.compact && data\.chartRepresentation\)/);
  });
});
