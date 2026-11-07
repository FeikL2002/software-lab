const form = document.querySelector('#entry-form');
const codeInput = document.querySelector('#entry-code');
const submitButton = document.querySelector('#entry-submit');
const toggleButton = document.querySelector('#entry-toggle');
const errorMessage = document.querySelector('#entry-error');
const statusMessage = document.querySelector('#entry-status');

// Older previews stored the room code in this browser; entry access now uses a server cookie.
try { window.sessionStorage.removeItem('os-room'); } catch { /* Storage may be unavailable in private browsers. */ }

if (form && codeInput && submitButton && toggleButton && errorMessage && statusMessage) {
  let submitting = false;
  let configured = document.documentElement.dataset.entryConfigured !== 'false';

  const setBusy = (busy) => {
    submitting = busy;
    form.setAttribute('aria-busy', String(busy));
    codeInput.disabled = busy || !configured;
    submitButton.disabled = busy || !configured;
    toggleButton.disabled = busy || !configured;
    submitButton.textContent = busy ? 'Checking code…' : 'Enter OddsScout';
  };

  const showError = (message) => {
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
    codeInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  toggleButton.setAttribute('aria-controls', 'entry-code');
  toggleButton.setAttribute('aria-pressed', 'false');
  toggleButton.addEventListener('click', () => {
    const reveal = codeInput.type === 'password';
    const selectionStart = codeInput.selectionStart;
    const selectionEnd = codeInput.selectionEnd;
    codeInput.type = reveal ? 'text' : 'password';
    toggleButton.textContent = reveal ? 'Hide' : 'Show';
    toggleButton.setAttribute('aria-pressed', String(reveal));
    toggleButton.setAttribute('aria-label', reveal ? 'Hide access code' : 'Show access code');
    codeInput.focus();
    if (selectionStart !== null && selectionEnd !== null) codeInput.setSelectionRange(selectionStart, selectionEnd);
  });

  codeInput.addEventListener('input', () => {
    if (errorMessage.textContent) showError('');
    statusMessage.textContent = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !configured) return;
    if (!codeInput.value.trim()) {
      showError('Enter the access code to continue.');
      codeInput.focus();
      return;
    }

    showError('');
    statusMessage.textContent = 'Checking your access code…';
    const code = codeInput.value;
    setBusy(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ code }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.authenticated !== true) {
        statusMessage.textContent = '';
        if (result?.code === 'ACCESS_NOT_CONFIGURED') configured = false;
        let message = typeof result?.error === 'string' ? result.error : 'Unable to check your code. Please try again.';
        if (response.status === 429) {
          const seconds = Number(response.headers.get('Retry-After'));
          message = Number.isFinite(seconds) && seconds > 0
            ? `Too many attempts. Wait ${Math.ceil(seconds)} seconds, then try again.`
            : 'Too many attempts. Wait a moment, then try again.';
        }
        showError(message);
        codeInput.value = '';
        setBusy(false);
        if (configured) codeInput.focus();
        return;
      }
      codeInput.value = '';
      statusMessage.textContent = 'Access approved. Opening OddsScout…';
      window.location.reload();
    } catch (error) {
      statusMessage.textContent = '';
      showError(error?.name === 'AbortError'
        ? 'The access check took too long. Please try again.'
        : 'Unable to connect. Check your connection and try again.');
      setBusy(false);
      codeInput.focus();
    } finally {
      clearTimeout(timeout);
    }
  });

  setBusy(false);
  if (configured) codeInput.focus({ preventScroll: true });
}
