# Privacy

August Trading is a **local-first** desktop/web app. Your journal, your charts and
your notebooks live on your machine. This document describes the two places data
does leave it, and what never leaves at all.

Last reviewed: 2026-09-26.

## What never leaves your machine

- **Your trade journal and its outcomes** — stored locally, exported only when you
  ask for it (Settings → Data: back up / export / import).
- **Your notebooks** — the learned-skill files, your notes, and the doctrine the
  loop consolidates them into.
- **Your drawings on charts.**
- **Your API keys** — stored in app Preferences. On desktop they are encrypted at
  rest with the operating system's keychain (`safeStorage`); in the browser they
  are plaintext in your browser's local storage, which is why the app is meant to
  be run locally or on a machine you trust.
- **Your exchange account** — the app has no exchange account access at all. It
  cannot read your balance or positions, and it cannot place or sign a trade.

## What leaves your machine

### 1. Market data from Binance (public, read-only)

The app reads **public** market data to draw charts and compute indicators:

| Endpoint | Used for |
|---|---|
| `api.binance.com/api/v3/klines` | candles |
| `api.binance.com/api/v3/ticker/price` | spot price |
| `data-api.binance.vision/api/v3/*` | Binance's market-data-only host (fallback) |
| `fapi.binance.com/fapi/v1/premium` | funding rate, open interest basis |
| `stream.binance.com`, `fstream.binance.com` | live price/depth websockets |

These requests carry **no API key, no signature, and no account information**.
They are the same requests any price widget on the web makes, and they reveal
nothing about you beyond an ordinary IP connection. You can verify this: search
the source for `X-MBX-APIKEY` or any signed endpoint — there is none.

### 2. Your prompts and chart context, to the AI providers *you* configure

When you send a message, the app sends the model whatever that message needs in
order to answer it: your prompt, recent conversation history, and a
code-calculated market packet for the instrument you are looking at (current
price, candles, your drawings, any levels you have set).

**Those providers are third parties you choose in Settings → Providers.** For
example, if you configure OpenRouter, your prompts and market context are sent to
OpenRouter and onward to whichever model it routes to. That data is then subject
to *their* terms and retention policies, not this project's.

Practical consequences worth stating plainly:

- A prompt that contains a position, an entry or a plan is leaving your machine
  when you send it. Do not paste account numbers or anything you would not put
  in a chat window.
- This is why the app is local-first and why you should configure a provider you
  have chosen deliberately. Nothing is sent anywhere until you type a message and
  press send.

### 3. The update check

The app checks GitHub for a newer release. That is an ordinary HTTPS request to
GitHub carrying no personal data.

## Analytics and tracking

There are none. No telemetry, no crash reporting, no usage analytics, no
third-party scripts. Nothing in this app phones home except the two categories
above, both of which are either a public market-data request or a message you
sent on purpose.

## Deleting your data

- **Everything of yours** is in the app's local storage. Deleting the app's data
  directory, or using the platform's "clear site data", removes it.
- **At a provider** — your prompts are not retrievable through this app. To
  delete conversation history held by a third-party provider, use that provider's
  own controls (most expose a data export and deletion request).

## Children

August Trading is not intended for anyone under 18, and it is not a financial
service. It does not provide investment advice, execute trades, or hold your
money. See the in-app notice: analysis and journaling only.

## Contact

This project is open source; issues and questions belong on the repository.
