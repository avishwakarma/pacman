// Stage 2 (this branch): adds real WebGPU rendering on top of Stage 1's
// Canvas 2D game. chooseRenderer() below tries WebGPU first and falls back
// to the exact same Canvas 2D renderer from `main` on any failure — the
// game logic itself (game/*.js) has no idea which one is drawing it. The
// autopilot agent and WebMCP tool-calling still exist in this repo
// (game/agent.js, mcp/*.js, ai/tool-loop.js) but aren't wired in yet — see
// README.md's branch table for what `player-agent` and `webmcp` add.

import './style.css';
import { checkWebGPUSupport } from './render/utils/capability-check.js';
import { renderFallback, initCanvasRenderer, renderFrame } from './render/canvas-renderer.js';
import { initRenderer, renderFrameGPU } from './render/webgpu-renderer.js';
import { loadModel } from './ai/llm-loader.js';
import { initChatPanel, appendMessage } from './ai/chat-panel.js';
import { createInitialState } from './game/gameState.js';
import { handleKeyDown, movePlayer } from './game/player.js';
import { moveGhosts, startFrightenedMode, updateGhostModes } from './game/ghosts.js';
import { tryEatPellet, tryEatPowerPellet } from './game/pellets.js';
import { checkGhostCollision } from './game/collisions.js';

const canvas = document.getElementById('game-canvas');
const modelStatus = document.getElementById('model-status');
const scoreValue = document.getElementById('score-value');
const livesEl = document.getElementById('lives');
const rendererLabel = document.getElementById('renderer-label');
const startOverlay = document.getElementById('start-overlay');
const gameOverOverlay = document.getElementById('game-over-overlay');
const pauseOverlay = document.getElementById('pause-overlay');

// Matches src/render/canvas-renderer.js's drawPlayer() exactly (radius 10,
// mouth wedge at 0.26*PI) so the lives indicator is the same shape as the
// player in the maze, not a separate icon that could drift from it.
const PACMAN_WEDGE_PATH = 'M10 10 L16.85 17.29 A10 10 0 1 1 16.85 2.71 Z';

// Called once per tick (see below) while a life is lost at most once every
// few seconds, so bail out via childElementCount before rebuilding the SVG
// icons — innerHTML-ing three tiny <svg>s 60 times a second for no reason
// is wasted work for something that's visually static almost every frame.
function renderLives(lives) {
  if (livesEl.childElementCount === lives) return;
  livesEl.innerHTML = Array.from(
    { length: lives },
    () => `<svg class="life-icon" viewBox="0 0 20 20"><path d="${PACMAN_WEDGE_PATH}"/></svg>`,
  ).join('');
}

// Guards the global keydown listener below: the chat input shares the page
// with the game, so without this check typing a message would also drive
// Pacman around (arrow keys/WASD) and space would start/restart the game
// out from under the player.
function isTypingInField() {
  const active = document.activeElement;
  return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

// aria-hidden is kept in sync alongside the .visible class (rather than
// relying on display:none alone) so assistive tech doesn't see stale
// overlay text as still present while it's visually hidden.
function syncGameOverOverlay(state) {
  gameOverOverlay.classList.toggle('visible', state.gameOver);
  gameOverOverlay.setAttribute('aria-hidden', String(!state.gameOver));
}

// Tries WebGPU first, falls back to Canvas 2D on any failure — both draw
// the exact same game state, so the rest of the game loop below never
// needs to know which one is active beyond calling drawFrame(state). The
// cabinet footer only has room for a short renderer name (see the Figma
// design), so the full fallback reason goes in a title attribute instead
// of the visible label — still inspectable, just not printed on-screen.
async function chooseRenderer() {
  const support = await checkWebGPUSupport();
  if (!support.supported) {
    rendererLabel.textContent = 'Canvas 2D';
    rendererLabel.title = `WebGPU not available — using Canvas 2D (${support.reason})`;
    const ctx = initCanvasRenderer(canvas);
    return { frame: (state) => renderFrame(ctx, state) };
  }

  try {
    const gpu = await initRenderer(canvas, support.adapter);
    rendererLabel.textContent = 'WebGPU';
    rendererLabel.title = 'WebGPU renderer active';
    return { frame: (state) => renderFrameGPU(gpu, state) };
  } catch (err) {
    console.error(err);
    rendererLabel.textContent = 'Canvas 2D';
    rendererLabel.title = `WebGPU not available — using Canvas 2D (${err.message})`;
    const ctx = initCanvasRenderer(canvas);
    return { frame: (state) => renderFrame(ctx, state) };
  }
}

function syncStartOverlay(started) {
  startOverlay.classList.toggle('visible', !started);
  startOverlay.setAttribute('aria-hidden', String(started));
}

function syncPauseOverlay(paused) {
  pauseOverlay.classList.toggle('visible', paused);
  pauseOverlay.setAttribute('aria-hidden', String(!paused));
}

async function startGame() {
  let drawFrame;
  let state;
  try {
    // chooseRenderer() already handles a WebGPU failure internally (falls
    // back to Canvas 2D), so what's actually likely to throw here is
    // initCanvasRenderer's own setup (e.g. no 2D context available) or
    // createInitialState — caught here so a broken environment gets a
    // readable message drawn on the canvas instead of a blank page and a
    // silent console error.
    const renderer = await chooseRenderer();
    drawFrame = renderer.frame;
    state = createInitialState();
    renderLives(state.lives);
  } catch (err) {
    console.error(err);
    renderFallback(canvas, `Game failed to start: ${err.message}`);
    return;
  }

  // The maze/pellets/ghosts/player all render immediately, at rest — only
  // the simulation itself (movement, ghost AI, collisions) waits for a
  // first Space press, same idea as an arcade cabinet's "press start"
  // screen instead of dropping the player straight into a moving game.
  let started = false;
  syncStartOverlay(started);

  // Pausing only makes sense mid-run, so it's a third, separate flag rather
  // than reusing `started` (that would also re-show the start overlay) or
  // `state.gameOver` (that's a real loss, not a break).
  let paused = false;

  // Space is special-cased here rather than routed through player.js's
  // handleKeyDown: it's a meta-control (start/restart/pause the run) rather
  // than a movement input, and it needs to read/replace `started`/`state`/
  // `paused`, which handleKeyDown has no reason to own.
  window.addEventListener('keydown', (event) => {
    if (isTypingInField()) return;

    if (event.key === ' ') {
      event.preventDefault();
      if (!started) {
        started = true;
        syncStartOverlay(started);
      } else if (state.gameOver) {
        state = createInitialState();
      } else {
        paused = !paused;
        syncPauseOverlay(paused);
      }
      return;
    }

    handleKeyDown(state, event);
  });

  let lastTime = performance.now();
  function tick(now) {
    // Clamp dt so a stalled/backgrounded tab resuming doesn't let an
    // entity's next movement step jump clean through a wall.
    const deltaTime = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Simulation only advances once the player has pressed Space, the run
    // isn't over, and it isn't paused; rendering happens unconditionally
    // below so the maze/pellets/ghosts still draw (just frozen) behind the
    // start/game-over/pause overlays instead of vanishing while they're up.
    // Order here matters: movement and ghost-mode updates happen before the
    // pellet/collision checks that read this frame's positions, not last
    // frame's.
    if (started && !state.gameOver && !paused) {
      movePlayer(state, deltaTime);
      updateGhostModes(state, deltaTime);
      moveGhosts(state, deltaTime);
      tryEatPellet(state);
      if (tryEatPowerPellet(state)) startFrightenedMode(state);
      checkGhostCollision(state);
      scoreValue.textContent = state.score;
      renderLives(state.lives);
    }

    syncGameOverOverlay(state);
    drawFrame(state);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Chat and model loading are independent of the game and of each other:
// the panel is usable (if only echoing, for now) whether or not the model
// has finished downloading, and loadModel's progress callback/promise just
// keep #model-status current as loading proceeds in the background.
function startChat() {
  initChatPanel(() => {
    appendMessage('assistant', 'Chat is wired up, but tool calling comes in a later stage — for now this just echoes.');
  });

  loadModel((progress, text) => {
    modelStatus.textContent = `Loading model… ${Math.round(progress * 100)}% ${text ?? ''}`.trim();
  })
    .then(() => {
      modelStatus.textContent = 'Model loaded';
    })
    .catch((err) => {
      modelStatus.textContent = `Model failed to load: ${err.message}`;
    });
}

startGame();
startChat();
