(() => {
  'use strict';
  const dialog = document.getElementById('feedbackDialog');
  const form = document.getElementById('feedbackForm');
  const openButton = document.getElementById('feedbackOpen');
  if (!dialog || !form || !openButton) return;
  const fields = document.getElementById('feedbackFields');
  const sendButton = document.getElementById('feedbackSend');
  const status = document.getElementById('feedbackStatus');
  const success = document.getElementById('feedbackSuccess');
  const intro = document.getElementById('feedbackIntro');
  const message = document.getElementById('feedbackMessage');
  const title = document.getElementById('feedbackRequestTitle');
  const name = document.getElementById('feedbackName');
  const views = new Set(['overview', 'tickets', 'scan', 'numbers', 'more', 'scratch', 'stores', 'backup', 'statsview', 'nearby']);
  let busy = false;
  let opener = null;

  function showStatus(text, kind = 'info') {
    status.textContent = text;
    status.dataset.kind = kind;
    status.hidden = !text;
  }
  function setBusy(value) {
    busy = value;
    fields.disabled = value;
    sendButton.disabled = value;
    form.setAttribute('aria-busy', String(value));
    sendButton.textContent = value ? 'Sending your request…' : 'Send request';
  }
  function updateCount() {
    document.getElementById('feedbackMessageCount').textContent = message.value.length.toLocaleString('en-US') + ' / 3,000 characters';
  }
  function currentPage() {
    const page = document.querySelector('.view:not([hidden])')?.id || 'overview';
    return views.has(page) ? page : 'overview';
  }
  function open() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
    if (!dialog.open) dialog.showModal();
    if (success.hidden && !busy) title.focus({ preventScroll: true });
    else if (!success.hidden) success.focus({ preventScroll: true });
  }
  function close() { dialog.close(); }
  function newRequest() {
    form.reset();
    [name, title, message].forEach(input => input.setCustomValidity(''));
    updateCount();
    showStatus('');
    success.hidden = true;
    form.hidden = false;
    intro.hidden = false;
    title.focus({ preventScroll: true });
  }

  openButton.addEventListener('click', open);
  document.getElementById('feedbackClose').addEventListener('click', close);
  document.getElementById('feedbackDone').addEventListener('click', close);
  document.getElementById('feedbackAnother').addEventListener('click', newRequest);
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  [name, title, message].forEach(input => input.addEventListener('input', () => input.setCustomValidity('')));
  message.addEventListener('input', updateCount);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    for (const input of [name, title, message]) {
      input.setCustomValidity(input.value.trim() ? '' : 'Please add a few words here.');
    }
    if (!form.reportValidity()) return;
    if (navigator.onLine === false) {
      showStatus('You’re offline. Your note is still here. Connect to the internet, then tap Send request when you’re ready.', 'error');
      status.focus({ preventScroll: true });
      return;
    }
    form.elements.namedItem('app-page').value = currentPage();
    // Explicitly send only these form fields, never app records or browser storage.
    const body = new URLSearchParams(new FormData(form));
    for (const key of ['name', 'title', 'message', 'email']) body.set(key, String(body.get(key) || '').trim());
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    setBusy(true);
    showStatus('Sending your note. You can leave this window open while it finishes.');
    try {
      const response = await fetch('/__forms.html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'same-origin',
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Submission rejected');
      form.hidden = true;
      intro.hidden = true;
      success.hidden = false;
      showStatus('');
      if (dialog.open) success.focus({ preventScroll: true });
    } catch (error) {
      if (timedOut || error instanceof TypeError || error?.name === 'AbortError') {
        showStatus('We couldn’t confirm whether your note arrived. It’s still here, and nothing will be sent again automatically. If you choose to send it again, Lewis might receive it twice.', 'error');
      } else {
        showStatus('Your request wasn’t accepted. Your note is still here — please try Send request again in a moment.', 'error');
      }
      if (dialog.open) status.focus({ preventScroll: true });
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  });
  updateCount();
})();
