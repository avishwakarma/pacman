# Project Brief for Claude Code

## What we're building

A browser-based Pacman game used as a live-build demo for a 2-hour workshop titled "Building Autonomous Web Agents with WebGPU and WebMCP" in Bangalore.

Workshop shape is fixed, roughly 20 min deck + 40 min live build, twice. That's the real constraint on scope below, everything here is sized to fit inside two 40 minute live-build windows with a room full of people typing along, not to be a complete game.

**Stage 1 - WebGPU (deck 20 min, build 40 min)**
A minimal but real Pacman rendered using WebGPU. Maze, player movement, a couple of ghosts, pellets, score, one lose condition.

**Stage 2 - WebMCP + local LLM (deck 20 min, build 40 min)**
A local, in-browser LLM (via WebLLM) controls the running game through a small set of WebMCP tools, plus one or two cheat codes for a fun finish.

The repo will be pushed to GitHub and handed to attendees ahead of time as prep material, so it needs to be genuinely easy to clone, install, and run before the event.

## Pre-scaffolded vs built live

This is the key decision for fitting the timeline. Anything that is plumbing rather than the teaching point should already exist in the starter repo, so live time goes to the concepts we're actually teaching.

**Already done in the starter (attendees don't build this live)**

- Vite project setup, dependencies installed
- Canvas 2D fallback and capability check for WebGPU, wired but stubbed
- Chat panel UI shell (input box, message list), no logic yet
- WebLLM loading and progress indicator, already calling a working `loadModel()` function
- Maze layout data (the grid itself as a static asset)

**Built live in Stage 1**

- WebGPU render pipeline that draws the maze and player from the provided grid data
- Player movement and wall collision
- 1 to 2 ghosts with simple random-direction movement, no real pathfinding
- Pellets, score counter, one lose condition (ghost touches player)

**Built live in Stage 2**

- Registering 3 to 4 WebMCP tools against the already-running game
- Wiring the chat panel to send prompts to the already-loading model and let it call those tools
- One cheat code tool, for the live demo payoff

## Tech stack

- Plain JavaScript, no heavy framework, keep it approachable for a live workshop audience
- WebGPU for rendering, Canvas 2D fallback already scaffolded
- WebLLM (MLC AI), a small quantized model in the 1B to 3B range like Llama 3.2 1B or Phi-3.5 mini, chosen for fast load on conference wifi
- WebMCP `navigator.modelContext` API for tool registration, guarded behind a feature check since it currently needs a Chrome flag or origin trial
- Vite for dev server and bundling
- No backend, everything runs client side

## Repo structure

```
pacman/
  README.md
  SETUP.md
  package.json
  vite.config.js
  public/
  src/
    game/
      maze.js
      player.js
      ghosts.js
      pellets.js
      collisions.js
      gameState.js
    render/
      webgpu-renderer.js
      canvas2d-fallback.js
      capability-check.js
    ai/
      llm-loader.js
      chat-panel.js
    mcp/
      tools.js
      register-tools.js
    main.js
  branches (or tagged commits)
    stage-1-webgpu-only     - finished Stage 1, starting point for Stage 2
    stage-2-final           - fully finished reference build
    main                    - starter with the pre-scaffolded pieces above, this is what attendees clone and build from live
```

## Stage 1 requirements (WebGPU Pacman)

- Maze rendered on a WebGPU canvas from the provided grid data, doesn't need to be pixel perfect to the original
- Player controlled with arrow keys or WASD, grid based movement, wall collision
- 1 to 2 ghosts, random valid direction movement only, no chase AI, this is scoped down on purpose to fit 40 minutes
- Pellets and score counter
- One lose condition, ghost touches player, no win condition needed for the demo
- Code broken into small modules so a live audience can follow along and modify one file at a time

## Stage 2 requirements (WebMCP + local LLM)

- Wire the already-scaffolded chat panel to the already-loading WebLLM instance
- Tool layer registered via `navigator.modelContext`, keep this to 3 to 4 tools so it's demoable inside the window
  - `spawnGhost` - adds a ghost to the maze at a valid position
  - `freezeGhosts` - stops ghost movement for N seconds
  - `dropPowerPellet` - places a power pellet near the player, eating it makes ghosts vulnerable for a short time
  - `getGameState` - read only tool returning current score, ghost count, pellet count, so the model can answer questions before acting

- One cheat code tool for the demo finish, pick `ghostOverload`, once ghost count crosses a threshold (say 5 or more) all ghosts get destroyed at once with a visible effect, this is a natural payoff after a few rounds of `spawnGhost` prompts and needs no extra game rule beyond a threshold check
- Each tool needs a clear natural language description and a JSON schema for its parameters
- Tool calls should visibly affect the running game in under a second
- Include 3 to 4 example prompts in the README known to work well, covering the core tools and the one cheat code, like "spawn two more ghosts", "freeze the ghosts for five seconds", "things are getting out of hand, wipe them all out"

## Cut from this version, keep as stretch goals only

These were considered but don't fit the two 40 minute windows, note them in the README as "if you want to extend this after the workshop" rather than building them live, `reverseGhostFear`, `godMode`, `chaosMode`, maze theme switching, win condition and multiple lives, real ghost pathfinding AI, sound effects.

## Setup docs to generate

**README.md**
Project overview, what the workshop is, screenshot or gif placeholder, quick start commands, link to SETUP.md, the 3 to 4 example prompts for Stage 2, a short "extend this later" list from the cut section above.

**SETUP.md**
Step by step, aimed at someone setting this up the night before with no help available.

- Node version required
- Clone and install commands
- Chrome version required, exact steps to enable the WebGPU and WebMCP flags if needed
- A short script or checklist to confirm WebGPU is working, so people can self-diagnose before the event
- How to check out `stage-1-webgpu-only` if someone falls behind and wants to jump straight into Stage 2
- Troubleshooting for the likely failure modes, unsupported GPU, flag not enabled, model download stuck, corporate network blocking the download

## Constraints and preferences

- Favor readable, well commented code over clever abstractions, this needs to be explainable live in a 40 minute window
- Keep individual files short enough to put one on a projector and walk through in a few minutes
- No external backend or API keys anywhere in the stack
- Flag any part of the WebMCP API likely to change soon or that only works behind a specific Chrome flag, so the setup docs stay accurate

## What I want from you first

Start by proposing the exact tool schemas for the 4 Stage 2 tools listed above (3 core plus `ghostOverload`), in JSON schema form, plus a short plan for the git branches or tags. Once I confirm those, scaffold the pre-scaffolded starter pieces first, then Stage 1.
