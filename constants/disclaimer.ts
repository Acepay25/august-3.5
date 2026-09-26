/**
 * The one place the app says what it is not.
 *
 * WHY THIS IS A CONSTANT AND NOT A STRING. The disclaimer lived in exactly one
 * place — the Chart AI dock's composer footer — which is the least-read corner
 * of the app. Everywhere else a trader could form the wrong impression, the
 * app said nothing. That is the failure mode that matters: someone reads
 * "ensemble debate", "binding verdict", "autopilot" and reasonably assumes
 * something places orders on their behalf. It does not. The app has no
 * order-placement code path at all — every Binance call is a PUBLIC market
 * data endpoint, with no key, no signature, and no account access — and the
 * trader has to be told that in the places they will actually look.
 *
 * One constant, so the wording cannot drift between surfaces: a disclaimer
 * that says two slightly different things on two screens is worse than one
 * that says it once, clearly, in the right place.
 */

/** Shown inline, under a composer or a transcript. */
export const DISCLAIMER_SHORT =
    'August may make mistakes. Analysis and journaling only — it never places or signs a trade.';

/** Shown on first run, where the question is "what is this thing". */
export const DISCLAIMER_FIRST_RUN =
    'August Trading is an analysis and journaling tool. It reads public market data and '
    + 'talks to the AI providers you configure. It has no exchange account access, '
    + 'cannot place or sign a trade, and is not financial advice.';

/** Shown wherever a verdict is presented, next to the action it invites. */
export const DISCLAIMER_VERDICT =
    'A verdict is the model\'s reading of the chart — not a trade. Nothing here reaches an exchange.';
