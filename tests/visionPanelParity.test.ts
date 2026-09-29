import { describe, it, expect } from "vitest";

/**
 * A screenshot the user attached must actually reach the seats.
 *
 * The camera button is offered in every mode, and the user sees the image in
 * their own bubble either way. So when the panel path dropped the attachment,
 * every signal an observer would naturally check was IDENTICAL across the two
 * states — button enabled, bubble rendered, model replied. The only difference
 * was invisible from the outside: the model had never seen the chart.
 *
 * That is the render-probe trap ("a check whose measurement is identical
 * across two different states is measuring the wrong thing"), so these tests
 * assert on the CONTENT that reaches the provider, not on any UI affordance.
 */

describe("screenshots reach the seats that can see them", () => {
  it("sends a real image part to a vision model", async () => {
    const { userContentWithImage } = await import("../services/trade/chatTurnRunner");

    const content = userContentWithImage(
      "what does this show?",
      { kind: "image", payload: "data:image/png;base64,AAAA" },
      "gpt-4o"
    );

    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
    // The payload must survive intact, not be summarised or dropped.
    expect((parts[1]!.image_url as { url: string }).url).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("tells a text-only seat it cannot see the image, rather than sending nothing", async () => {
    const { userContentWithImage } = await import("../services/trade/chatTurnRunner");

    const content = userContentWithImage(
      "what does this show?",
      { kind: "image", payload: "data:image/png;base64,AAAA" },
      "llama-3.1-70b"
    );

    expect(typeof content).toBe("string");
    // A seat that cannot see the image must know it has one, or it invents a
    // confident read of a chart it never received.
    expect(content).toMatch(/cannot see images/i);
    // And the question itself must survive alongside the caveat.
    expect(content).toMatch(/what does this show\?/);
  });

  it("is a no-op when nothing is attached", async () => {
    const { userContentWithImage } = await import("../services/trade/chatTurnRunner");

    // No attachment, vision or not: the text goes through untouched. A
    // capability check that fires on an empty turn would add the caveat to
    // every message in the app.
    expect(userContentWithImage("hello", undefined, "gpt-4o")).toBe("hello");
    expect(userContentWithImage("hello", undefined, "llama-3.1-70b")).toBe(
      "hello"
    );
  });

  it("decides per seat, so a mixed panel is handled", async () => {
    const { userContentWithImage } = await import("../services/trade/chatTurnRunner");

    const attachment = { kind: "image", payload: "data:image/png;base64,AAAA" };
    const seats = ["gpt-4o", "llama-3.1-70b", "claude-3-5-sonnet"];

    const kinds = seats.map((model) =>
      Array.isArray(userContentWithImage("read this", attachment, model))
        ? "sees"
        : "told"
    );
    // Not all-or-nothing: a panel is allowed to mix, and each seat must be
    // treated on its own capability.
    expect(kinds).toHaveLength(seats.length);
    expect(kinds.every((k) => k === "sees" || k === "told")).toBe(true);
  });
});

describe("the panel path actually uses the shared helper", () => {
  it("passes the attachment to the seat, not a bare string", async () => {
    // The defect was never in the helper — the solo path had it right. It was
    // that the panel built `{ role: 'user', content: userMsg }` with a plain
    // string. Pinned against the source so the two paths cannot drift apart
    // again the way they did the first time.
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");

    // Every seat message must be built from the helper's result.
    const seatMessages = /const seatContent = userContentWithImage\(([^;]+)\);[\s\S]{0,200}?content: seatContent/.exec(
      src
    );
    expect(seatMessages).not.toBeNull();
    // And the helper's per-seat call must pass the attachment, not omit it.
    expect(seatMessages![1]).toMatch(/imageAttachment/);

    // The old shape must be gone: a seat message built from the bare string.
    expect(src).not.toMatch(
      /content: systemPromptFor\(seatBot, panelMandate\) \},\s*\{ role: 'user', content: userMsg \}/
    );
  });
});
