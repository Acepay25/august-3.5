import { describe, it, expect } from "vitest";

/**
 * The per-message context block had no cap at all.
 *
 * `buildTradeChatContext` concatenated the packet, the on-screen read, the
 * freshness note, armed plans, drawings and two long tool paragraphs with
 * nothing bounding it — so routine charts rode 8-12k chars into EVERY message,
 * including one-word questions.
 *
 * The trap in fixing it is WHERE you clip. The read rules are the TAIL of that
 * assembly, and a head-slice of the finished string eats exactly them. That is
 * the same defect that already shipped once inside
 * `generateHybridPromptInjection`: the SMC block was moved up for this reason
 * and the read rules were not. So the packet is clipped in place and the
 * instructions are never candidates.
 */

const huge = (n: number) => "P".repeat(n);

describe("the per-message block is bounded", () => {
  const base = {
    symbol: "BTCUSDT",
    interval: "15m",
    fetchedAtMs: 1_757_000_000_000,
  };

  it("clips an oversized packet and says how much was withheld", async () => {
    const { buildTradeChatContext } = await import(
      "../services/trade/tradeChatContext"
    );

    const out = buildTradeChatContext({
      ...base,
      packetMarkdown: huge(60_000),
    });

    // Bounded, and materially smaller than what went in.
    expect(out.length).toBeLessThan(30_000);
    // The dialect the model is already trained on: kept vs existed, and the
    // remedy. A silent truncation would read as "that is all there is".
    expect(out).toMatch(/truncated market packet/);
    expect(out).toMatch(/MISSING, not absent/);
    expect(out).toMatch(/get_market_packet|get_chart_view/);
  });

  it("keeps the read rules, which a head-slice would have eaten", async () => {
    const { buildTradeChatContext } = await import(
      "../services/trade/tradeChatContext"
    );

    const out = buildTradeChatContext({
      ...base,
      packetMarkdown: huge(60_000),
    });

    // The freshness note.
    expect(out).toMatch(/never narrate a move from that gap alone/);
    // The tool paragraph.
    expect(out).toMatch(/CALL THE DESK TOOLS/);
    // The growth paragraph.
    expect(out).toMatch(/write_memory_note/);
    // The clip note must come BEFORE these, i.e. it clipped the packet and
    // not the tail.
    expect(out.indexOf("truncated market packet")).toBeLessThan(
      out.indexOf("CALL THE DESK TOOLS")
    );
  });

  it("leaves a small packet completely untouched", async () => {
    const { buildTradeChatContext } = await import(
      "../services/trade/tradeChatContext"
    );

    const small = "PACKET BODY";
    const out = buildTradeChatContext({ ...base, packetMarkdown: small });
    // No clip note when nothing was clipped.
    expect(out).not.toMatch(/truncated/);
    expect(out).toContain(small);
  });

  it("scales the budget to the seat's real window", async () => {
    const { buildTradeChatContext } = await import(
      "../services/trade/tradeChatContext"
    );

    const body = huge(60_000);
    const smallWindow = buildTradeChatContext({
      ...base,
      packetMarkdown: body,
      contextWindowTokens: 8_000,
    });
    const bigWindow = buildTradeChatContext({
      ...base,
      packetMarkdown: body,
      contextWindowTokens: 400_000,
    });

    // A 1M-window seat should not be fed the same packet as a 32k one.
    // windowBudgetTokens keeps a floor, so this is a ratio, not a zero.
    expect(smallWindow.length).toBeLessThan(bigWindow.length);
  });

  it("the runner actually passes the seat's window", async () => {
    // Otherwise the cap silently runs on the default and the fraction is
    // decorative.
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");
    const sites = [
      ...src.matchAll(
        /buildTradeChatContext\(\{ symbol, interval, contextWindowTokens: provider\?\.contextWindowTokens/g
      ),
    ];
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });
});
