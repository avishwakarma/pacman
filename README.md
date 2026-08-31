# AgentNexus Pacman — WebGPU + WebMCP

A browser-based Pacman built as the live-coding project for **"Building Autonomous Web Agents with WebGPU and WebMCP,"** an AgentNexus workshop. No backend, no build step beyond Vite, no API keys — everything, including the AI, runs client-side.

The maze itself spells out **AGENTS** / **NEXUS** in its walls — every letter is fully walkable, not just decoration.

## Branches — pick your stage

The workshop moves through four stages, one branch each. **Every branch already contains the full, real implementation of every stage** — nothing is a stub past `main`. What changes branch to branch is a small, deliberate wiring diff in `src/main.js` (plus a small UI hook where a stage needs one) that turns the next piece on. That's on purpose: the heavy code (the WebGPU pipeline, the tool-calling loop, the autopilot) is already written and gets explained, not typed from scratch live — so if you fall behind, or want to jump ahead, you can check out the branch that matches where the room is and be at a fully working, consistent state.

| Branch | Adds | What you get |
| --- | --- | --- |
| `main` | — | A complete, playable Pacman: grid-based movement, real ghost chase AI, power pellets that make ghosts vulnerable, score, 5 lives. Canvas 2D only. |
| `webgpu` | WebGPU rendering | The same game, now rendered with a real WebGPU pipeline instead of Canvas 2D (falls back automatically if WebGPU isn't available). |
| `webmcp` | WebMCP + chat | A local LLM (via WebLLM) drives the game through a handful of WebMCP tools from the chat panel — spawn ghosts, freeze them, drop a power pellet, or trigger the cheat code, all through natural language. |
| `player-agent` | Autonomous Play | The finale. A deterministic autopilot (a HUD toggle, not chat-controlled) plays the game itself — real shortest-path pellet-seeking and ghost-avoidance, same technique the ghost AI already uses. |

This README is identical on every branch — it's the one reference doc regardless of which stage you've checked out. The [`codelab/`](./codelab) directory has the step-by-step, hands-on guide for actually working through the stages live.

A design choice worth calling out: the autopilot is **not** LLM-driven, on purpose. An earlier version had the model turn it on and steer its strategy via WebMCP tools every few seconds — reliably getting a small local model to remember "the autopilot needs to be on" turned out to not be dependable enough for something this basic, and the repeated re-invocation added a lot of failure surface (context growth, races between calls) for what it bought. Stage 3's reactive tool-calling already demonstrates the actual WebMCP/LLM story well; this stage keeps that intact and adds the autopilot purely as a reliable, deterministic capability alongside it.

## Setup

Do this the night before the workshop, not in the room — the model download for Stage 3 onward can take a few minutes on a good connection, and conference wifi is not a good connection.

### 1. Node

Node 20 or newer. Check with:

```bash
node -v
```

If you use nvm, `.nvmrc` is in this repo — `nvm use` picks up 20 automatically.

### 2. Clone and install

```bash
git clone <this-repo-url>
cd pacman
npm install
```

This pulls in Vite and `@mlc-ai/web-llm`. No API keys, no `.env` file — everything runs client-side.

### 3. Browser requirements — depends which branch

**On `main`**, any modern browser with Canvas 2D and ES modules works fine — any current Chrome, Firefox, Safari, or Edge. Nothing below is required yet.

**`webgpu` branch onward**: you need **Chrome 113 or newer** (WebGPU ships enabled by default on Windows/macOS/Linux since then — no flag required).

**`webmcp` branch onward**: the chat model itself (`Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC`) needs about **5GB of GPU VRAM** — an older/integrated GPU or a machine already under memory pressure may fail to load it even though WebGPU itself works fine for rendering. This is separate from `navigator.modelContext` / `document.modelContext`, which is newer and still moving:
- It's shipped behind an **origin trial** on recent Chrome stable, which for local development just means it works on `localhost` without extra setup.
- If it's not available in your Chrome version, check `chrome://flags` for anything WebMCP-related.
- **This is a fast-moving API** — the exact registration shape and whether it's `navigator.modelContext` or `document.modelContext` has already changed during the origin trial (Chrome 150 deprecated the `navigator` version in favor of `document`). The chat panel works even if this browser-level registration isn't available on your Chrome build — it drives the local model directly either way — but the WebMCP-specific piece (an *external* agent discovering this page's tools) needs it. Check the console; the app feature-detects and won't throw either way.

### 4. Confirm WebGPU is working (once you're on the `webgpu` branch or later)

Open DevTools (`Cmd+Option+J` / `Ctrl+Shift+J`) on any page and run:

```js
if (!navigator.gpu) {
  console.log("No WebGPU support in this browser at all.");
} else {
  const adapter = await navigator.gpu.requestAdapter();
  console.log(
    adapter
      ? "WebGPU is working."
      : "navigator.gpu exists but no adapter is available — likely a GPU/driver issue."
  );
}
```

If that prints "WebGPU is working," you're set. If not, see Troubleshooting below.

### 5. Run it

```bash
npm run dev
```

Open the URL Vite prints (it should also open automatically).

### 6. Jumping between stages

Every stage lives on its own branch, each a strict superset of the previous one:

```bash
git checkout main            # Stage 1: playable game, Canvas 2D
git checkout webgpu          # + WebGPU rendering
git checkout webmcp          # + WebMCP chat control (reactive)
git checkout player-agent    # + a deterministic Autonomous Play toggle (final)
npm install
npm run dev
```

If you fall behind during the workshop, just check out whichever branch matches where the room currently is.

### Troubleshooting

**"navigator.gpu exists but no adapter is available"**
Usually an old/blocklisted GPU or outdated graphics drivers. Try `chrome://gpu` and look for WebGPU in the status list — if it says "Software only, hardware acceleration unavailable," update your GPU drivers or try a different machine for the workshop. Worst case: the `webgpu` branch automatically falls back to the exact same Canvas 2D renderer from `main`, so the game stays fully playable either way.

**WebMCP tools never register (browser-level `modelContext`)**
Confirm your Chrome version (`chrome://version`) is current. This only affects an *external* agent discovering this page's tools — the chat panel still drives the game via the local model directly, independent of this. (The `player-agent` branch's Autonomous Play toggle doesn't involve the model or WebMCP at all — it's a plain deterministic HUD button.)

**Model download stuck or very slow**
The model (`Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC`, ~5GB — see `src/ai/llm-loader.js` for why it's not a smaller model: WebLLM's tool-calling only works with a specific allowlist of Hermes-family models) is fetched from Hugging Face's CDN and cached in the browser (IndexedDB/Cache Storage) after the first load. If it's stuck at 0%, check the Network tab for failed requests. If it's just slow, that's conference wifi — do this step the night before on a real connection, not in the room. This is a genuinely large download; budget real time for it, don't leave it until the room fills up.

**Corporate network / VPN blocking the download**
Some corporate firewalls block Hugging Face's CDN. If you're on a managed laptop, try a personal hotspot for the initial download — once cached, the model loads from disk and works offline.

**Everything loads but nothing renders**
Open the console. The app is written to fall back to a visible message on the canvas rather than a blank screen — if you see a blank canvas with no message at all, that's a real bug, not a missing-feature fallback; check the console for the actual error.

## Stage 1 — the playable game

- Loading the page shows a "press SPACE to play" screen — the maze, pellets, ghosts, and player all render at rest, but nothing moves until the first Space press. No mid-air surprise start.
- Grid-locked movement (arrow keys or WASD), matching the original arcade's feel — direction changes only happen at intersections, not mid-corridor.
- Two ghosts chasing you by real shortest-path distance through the maze (not straight-line, and not random — see `src/game/ghosts.js`).
- Power pellets (always 4 on the board, respawning elsewhere each time one's eaten) turn ghosts vulnerable for 8 seconds — eat them for a score bonus that doubles each ghost you catch in one window.
- 5 lives, shown as small Pacman icons next to the score (the same wedge shape `render/canvas-renderer.js` draws for the player). A chasing ghost touching you costs a life and resets everyone to their spawn positions — `game/gameState.js`'s `resetPositions()` — with the game ending only once you're out. Press **Space** to restart after that.
- Press **Space** again mid-run to pause — everything freezes (the player, the ghosts, the timers) behind a PAUSED overlay, same visual language as the start/game-over screens. Press it again to resume.

## Stage 2 — WebGPU rendering

- `src/main.js`'s `chooseRenderer()` tries WebGPU first (`render/webgpu-renderer.js`), and falls back to the exact same Canvas 2D renderer from Stage 1 on any failure — same game state, same visuals, two different GPU paths.
- The cabinet footer's renderer label (bottom-right) tells you which one's actually active; hover it for the fallback reason if it's on Canvas 2D.
- The WebGPU pipeline (`render/webgpu-renderer.js` + `render/utils/gpu-shapes.js`) draws everything as plain colored triangles — no textures, no text rendering. It builds one vertex buffer once for the static maze (border, walls, ghost pen, letters) and rebuilds a second one every frame for whatever moves (pellets, ghosts, the player). Worth reading through — `gpu-shapes.js` has the actual triangle math (polygon triangulation, thick-line strokes, circle fans), `webgpu-renderer.js` has the pipeline setup and per-frame draw.

## Stage 3 — WebMCP + a local LLM (reactive)

- The AI Copilot panel is always open — there's no chat toggle anymore. Model loading kicks off immediately alongside the game itself, so it's usually ready well before you've finished a round.
- The panel's status card tracks the model through two states: a dark "LOCAL MODEL" card with a live load percentage while it downloads, then a green "LOCAL MODEL LOADED" card once it's ready. The message input only appears once loading finishes.
- Ask for something — the WebLLM model (`src/ai/llm-loader.js`) gets the tool schemas from `src/mcp/register-tools.js` and can call them via `src/ai/tool-loop.js`'s plain OpenAI-style tool-calling loop (WebLLM's `engine.chat.completions.create` supports `tools`/`tool_calls` directly — no extra plumbing needed).
- The same tool schemas are separately (and best-effort) registered against the browser's own `document.modelContext`/`navigator.modelContext` — the actual WebMCP API — so an *external* WebMCP-aware agent could discover and drive this same game too. That part is still a genuinely unstable, moving API (see Setup above); the chat panel itself doesn't depend on it succeeding.
- Five tools: `getGameState` (score, lives, ghost count, pellets left), `spawnGhost` (optionally more than one at once — `count`, up to 5), `freezeGhosts`, `dropPowerPellet`, and `ghostOverload` (the cheat code — needs 5+ ghosts on the board first).
- This is *reactive*: the model acts **at most once** per message you send, then waits — enforced in code (`ai/tool-loop.js`), not just asked for in the prompt. A message that isn't clearly asking for one of the five tools never reaches the model with `tools` attached at all (`mentionsAction()`, a plain keyword check); a message that is gets exactly one real tool call, no matter how many the model tries to chain afterward. Both of those replaced earlier versions that relied on prompt wording alone and misfired live — see `ai/tool-loop.js`'s header comment for the full story.
- Every tool call renders as a small formatted card in the chat log (`ai/chat-panel.js`'s `appendToolCall`) — a tool name header and a key/value table — instead of a raw JSON string, so a `getGameState` result reads at a glance.
- **WebLLM/Hermes gotchas worth knowing about** (both hit live and fixed in `ai/tool-loop.js`):
  - It sends *no* system message at all. WebLLM hard-codes its own Hermes function-calling system prompt and throws if `request.messages` contains one when `tools` is set — checked on every call by directly `unshift`-ing onto whatever array you passed, so passing your own persistent history array by reference gets it permanently (and silently) contaminated after the first call, breaking the very next one. Every call passes a fresh `[...messages]` copy instead.
  - An assistant message that made tool calls has `content: null` (valid — content's only required when there are no tool_calls). That's fine as the *last* message in a request, but WebLLM requires every assistant message to have string content once it's buried further back in later history, and throws otherwise. Every assistant message gets `content` normalized to `''` the moment it's received.

### Example prompts

Once the model has loaded, these are known to work well:

- _"Spawn two more ghosts"_
- _"Freeze the ghosts for five seconds"_
- _"How many pellets are left, and what's my score?"_
- _"Things are getting out of hand, wipe them all out"_ (the `ghostOverload` cheat — needs 5+ ghosts active first)
- _"Hi there"_ or _"what can you do?"_ — no tool call, just a plain-language list of what's available

## Stage 4 — Autonomous Play (final)

- Click **Autonomous Play** in the HUD (`game/agent.js`) and the player starts moving on its own: real shortest-path pellet-seeking, fleeing any chasing ghost within 6 grid steps — the exact same BFS-distance technique `game/ghosts.js`'s chase AI already uses, just retargeted. It never touches `movePlayer` directly — it only sets `state.player.queuedDirection`, the same field a keypress sets, so the movement engine can't tell a human and the autopilot apart. Click again to hand control back to the keyboard.
- **Ties are broken randomly, not always the same way** — at a junction where two or more directions are equally good, which one gets taken varies run to run, so the autopilot doesn't walk the identical path every single time. It's never a *worse* choice, only which of several equally-optimal paths gets taken.
- This is intentionally plain, deterministic JS — see the branch table above for why it's not LLM-driven.

## Extend this later

Cut from the workshop to keep each stage tight — good next steps if you want to keep going after:

- `reverseGhostFear`, `godMode`, `chaosMode` — more cheat-code tools
- Maze theme switching
- A win condition
- Sound effects

## License

MIT — do whatever you want with this.
