// Chat panel shell: wires up the DOM (input box + message list) that's
// already in index.html, with no send/model logic yet. Stage 2 hooks
// handleSubmit up to the loaded WebLLM engine and its registered tools.

const log = document.getElementById('chat-log');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');

// role ('user' | 'assistant' | anything else a later stage introduces, e.g.
// a tool-call card) becomes a CSS class, so the stylesheet — not this file
// — owns how each kind of message looks. textContent (not innerHTML): chat
// text is untrusted-ish (comes from user input and, later, model output)
// and never needs to render as markup.
export function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight; // keep the newest message in view
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null || value === undefined) return '—';
  return String(value);
}

// A tool call's result renders as a small labeled card instead of a raw
// JSON string — name is a schema tool name (e.g. "spawnGhost"), result is
// whatever that tool's handler returned (mcp/tools.js). Plain (non-object)
// results — a bare string or number, or an empty object — just show as-is
// rather than an empty table.
export function appendToolCall(name, result) {
  const card = document.createElement('div');
  card.className = 'message tool-card';

  const title = document.createElement('div');
  title.className = 'tool-card-name';
  title.textContent = `🔧 ${name}`;
  card.appendChild(title);

  const body = document.createElement('div');
  body.className = 'tool-card-body';

  const entries = result && typeof result === 'object' ? Object.entries(result) : [];
  if (entries.length === 0) {
    body.classList.add('plain');
    body.textContent = result == null ? '(no result)' : formatValue(result);
  } else {
    for (const [key, value] of entries) {
      const row = document.createElement('div');
      row.className = 'tool-card-row';

      const keyEl = document.createElement('span');
      keyEl.className = 'tool-card-key';
      keyEl.textContent = key;

      const valueEl = document.createElement('span');
      valueEl.className = 'tool-card-value';
      valueEl.textContent = formatValue(value);

      row.append(keyEl, valueEl);
      body.appendChild(row);
    }
  }

  card.appendChild(body);
  log.appendChild(card);
  log.scrollTop = log.scrollHeight;
}

// onSubmit is optional so this shell works standalone before a later stage
// wires up a real handler (e.g. loading the model first). preventDefault
// stops the form's default full-page-reload submit; the input only clears
// once there's actual non-whitespace text to send.
export function initChatPanel(onSubmit) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    appendMessage('user', text);
    input.value = '';
    onSubmit?.(text);
  });
}
