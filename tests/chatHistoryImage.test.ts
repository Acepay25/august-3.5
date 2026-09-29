import { describe, it, expect } from "vitest";

/* chatTurnRunner is a large module: under a full-suite run its transform alone
 * exceeds vitest's default per-test timeout, while the assertions below are
 * instant. The budget covers the import, not the test. */
const HEAVY_IMPORT_MS = 30_000;

/**
 * A follow-up turn must not forget the screenshot the turn before.
 *
 * The user attaches a chart, gets an answer, then asks "what about that
 * pattern?". The screenshot was STORED the whole time — `StoredChatEntry.image`
 * exists, which is exactly why RETRY could recover it and send it again — but
 * the history rebuild read `e.text` alone. So the second question was answered
 * by a model that had never seen the chart, with nothing indicating it was
 * working blind.
 *
 * Rebuilt through `userContentWithImage`, the same helper the live turn uses
 * after the panel-parity fix, so a prior image is re-sent as a real part and a
 * text-only seat is told the image is there rather than silently not knowing.
 *
 * SCOPE, stated honestly: this is the SOLO path. The panel seat does not
 * receive the user's earlier turns AT ALL — it gets the current turn plus a
 * transcript of the other SEATS (`formatRoomTranscript` renders seats, not the
 * user). Whether the panel should remember prior user turns is a separate
 * design question with a real prompt-size cost, and is deliberately not
 * answered here by smuggling an image through a path that has no user history.
 */

const IMG = "data:image/png;base64,AAAA";

describe("history carries its images", () => {
  it(
    "re-sends a prior screenshot as a real image part",
    async () => {
      const { userContentWithImage } = await import(
        "../services/trade/chatTurnRunner"
      );

      // The exact mapping the history rebuild now performs.
      const e = { role: "user" as const, text: "what is this?", image: IMG };
      const content =
        e.role === "user" && e.image
          ? userContentWithImage(
              e.text,
              { kind: "image", payload: e.image },
              "gpt-4o"
            )
          : e.text;

      expect(Array.isArray(content)).toBe(true);
      const parts = content as Array<Record<string, unknown>>;
      expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
      expect(parts[0]!.text).toBe("what is this?");
    },
    HEAVY_IMPORT_MS
  );

  it(
    "tells a text-only seat that an earlier image exists",
    async () => {
      const { userContentWithImage } = await import(
        "../services/trade/chatTurnRunner"
      );

      const content = userContentWithImage(
        "what is this?",
        { kind: "image", payload: IMG },
        "llama-3.1-70b"
      );
      // Silently omitting the image would be the same defect as V1: the seat
      // cannot tell a screenshot it was never sent from a question about a
      // chart it was never shown.
      expect(String(content)).toMatch(/cannot see images/i);
    },
    HEAVY_IMPORT_MS
  );

  it(
    "leaves an image-less entry as plain text",
    async () => {
      const { userContentWithImage } = await import(
        "../services/trade/chatTurnRunner"
      );
      // A question with no attachment must stay a bare string, or every prior
      // turn in every session starts growing a capability caveat.
      expect(userContentWithImage("just a question", undefined, "gpt-4o")).toBe(
        "just a question"
      );
    },
    HEAVY_IMPORT_MS
  );

  it("the rebuild reads entry.image, not text alone", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");

    // The old shape: role/content from e.text, image discarded.
    expect(src).not.toMatch(
      /e\.text\.trim\(\) \? \[\{ role: e\.role === 'user' \? 'user' : 'assistant', content: e\.text \}/
    );
    // The new one must branch on e.image.
    expect(src).toMatch(/e\.role === 'user' && e\.image/);
    expect(src).toMatch(/payload: e\.image/);
  });

  it("the stored entry really does carry the image (the premise)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatSessions.ts", "utf8");
    expect(src).toMatch(/image\?:\s*string;/);
  });
});
