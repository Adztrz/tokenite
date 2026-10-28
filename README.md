<p align="center">
  <img src="assets/banner.svg" alt="tokenite: usage left, reset times and a warm or cold prompt cache, in one slim band above the prompt" width="100%">
</p>

<p align="center">
  <img alt="Claude Code mod" src="https://img.shields.io/badge/Claude%20Code-mod-e9e1dc?labelColor=07090b">
  <img alt="Zero token cost" src="https://img.shields.io/badge/cost-0%20tokens-55bc82?labelColor=07090b">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-8a8b8a?labelColor=07090b">
</p>

---

A free, open-source mod for Claude Code. It adds one slim band above your prompt that shows:

| | **Usage** | **Prompt cache** |
|---|---|---|
| What | How much of your 7-day and 5-hour windows is **left**, and when each resets | Whether the cache is **warm** or **cold**, and what your next message costs |
| Where it comes from | The app's own rate-limit figures | The time of your last request and the size of your chat |
| Cost | Nothing: it never calls a model | Nothing |

It installs once and shows in every session after that. No commands to learn.

## Install

In Claude Code, type:

```
/plugin install tokenite --marketplace Adztrz/tokenite
```

1. Type `y` when it asks `Add marketplace?`.
2. Pick the **user** scope with Enter.
3. Start a new session.

Agents can run the same thing in a shell:

```
claude plugin install tokenite --marketplace Adztrz/tokenite
```

## What you see

### ● Usage left

- **7D** is your 7-day window, **5H** your 5-hour window.
- Each dot bar shows what is **left**, not what is used.
- Next to each one is when it resets, for example `· 3d 9h`.
- Under 15% left, a bold **LOW** appears.

### ● The prompt cache

After your first reply the band also tracks the prompt cache, which keeps your chat cheap to continue for one hour after your last request.

- **WARM** (red, the mark bobs): the cache is live. It shows the minutes left.
- **COLD** (blue, the mark is frozen in ice): the hour has passed. Your next message re-sends the whole chat, so it costs more. The price shows first.

Click **Show** to open the cache card and **Hide** to fold it. Warm starts folded; cold starts open, so you see the price before you send.

<p align="center">
  <img src="assets/card-warm.svg" alt="Warm cache card: 7m idle, 182k tokens in cache, next message priced per model with Opus marked YOU" width="100%">
</p>

<p align="center">
  <img src="assets/card-cold.svg" alt="Cold cache card: 12h 45m idle, 182k tokens to re-cache, next message $1.46 on Opus" width="100%">
</p>

### ● Fits any width

- **Wide:** everything on one row.
- **Half width:** each window stacks into a small block.
- **Narrow:** the cache moves to its own row.
- **Terminal:** the same facts as plain text.

## Good to know

- **Prices are estimates.** They come from the `MODELS` table in `hooks/cache-art.ts`, not from your bill. If prices change, edit that table.
- **Subagents don't count.** Only your main chat resets the cache clock.

## What is inside

```
tokenite/
├── .claude-plugin/
│   ├── plugin.json         the mod's name and version
│   └── marketplace.json    makes this repo installable
├── hooks/
│   ├── hooks.json          points to the module
│   ├── register.tsx        the band: usage, cache tracking, layout
│   ├── cache-art.ts        colours, the mark, the cache card, the price table
│   └── font.ts             Outfit, embedded so the drawings render anywhere
├── types/index.d.ts        the shape of what the band remembers
├── tests/                  7 tests: layouts, warm and cold, terminal, cleared sessions
└── assets/                 banner, mark, cache card renders
```

## Develop it

Load the folder without installing it:

```
claude --plugin-dir ./tokenite
```

Run the tests and checks:

```
claude plugin test ./tokenite
claude plugin validate ./tokenite
```

## Remove it

```
claude plugin uninstall tokenite
```

## License

[MIT](LICENSE). Based on [ribbon](https://github.com/robonuggets/ribbon), also MIT.

The embedded font is [Outfit](https://github.com/Outfitio/Outfit-Fonts), under the SIL Open Font License 1.1.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/mark-light.svg">
    <img src="assets/mark-dark.svg" alt="tokenite mark" width="40">
  </picture>
</p>
