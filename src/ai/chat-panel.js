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
