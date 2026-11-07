/* Home-screen installation is always initiated by Joe, never on page load. */
(() => {
  'use strict';

  const ua = navigator.userAgent || '';
  const android = /Android/i.test(ua);
  const ios = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mac = !ios && /Macintosh|Mac OS X/i.test(ua);
  const embedded = /;\s*wv\)|\bwv\b|FBAN|FBAV|Instagram|Snapchat|Line\//i.test(ua);
  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua);
  const modes = ['standalone', 'minimal-ui', 'window-controls-overlay'].map(mode => window.matchMedia('(display-mode: ' + mode + ')'));
  let deferredPrompt = null;
  let installed = false;
  let installing = false;
  let accepted = false;
  let dismissedForVisit = false;
  let opener = null;
  let notice = '';
  let checkingInstalled = false;
  const byId = id => document.getElementById(id);
  const isAppWindow = () => navigator.standalone === true || modes.some(mode => mode.matches);
  const appURL = () => new URL('./', document.baseURI).href;

  function platformCopy() {
    if (installed || isAppWindow()) return {
      title: 'Joe’s Lotto is installed.',
      intro: 'Open Joe’s Lotto from its icon whenever you want to scan a ticket or see your records.',
      steps: ['Look for the green Joe’s Lotto icon on your home screen or in your apps.', 'Keep using this same app and browser for your saved tickets.'],
      card: 'One tap from your home screen.',
      label: 'App installed'
    };
    if (android) return {
      title: 'Add Joe’s Lotto to your Android.',
      intro: embedded
        ? 'This link is open inside another app. Open it in Chrome first so Android can install it.'
        : 'Get a Joe’s Lotto icon on your home screen and open it in its own app window.',
      steps: embedded
        ? ['Open this browser’s menu and choose Open in Chrome or Open in browser. You can also copy the link below and paste it into Chrome.', 'In Chrome, tap the ⋮ menu beside the address bar.', 'Choose Install and create shortcut, then Install. Some versions call this Add to Home screen or Install app.', 'Confirm the installation, then open the green Joe’s Lotto icon.']
        : ['Open this page in Chrome on your Android phone.', 'Tap the ⋮ menu beside the address bar.', 'Choose Install and create shortcut, then Install. Some versions call this Add to Home screen or Install app.', 'Confirm the installation, then open the green Joe’s Lotto icon.'],
      card: 'Put your tickets one tap away. Add Joe’s Lotto to your Android home screen.',
      label: 'Add to home screen'
    };
    if (ios) return {
      title: 'Add Joe’s Lotto to your home screen.',
      intro: 'Open this page in Safari, then add the app to your iPhone or iPad.',
      steps: ['In Safari, tap Share.', 'Choose Add to Home Screen. You may need to scroll through the sharing options.', 'Tap Add, then open the Joe’s Lotto icon on your home screen.'],
      card: 'Open your tickets from a Joe’s Lotto icon on your home screen.',
      label: 'Add to home screen'
    };
    if (mac && safari) return {
      title: 'Keep Joe’s Lotto in your Dock.',
      intro: 'On macOS Sonoma 14 or later, Safari can give Joe’s Lotto its own window and Dock icon.',
      steps: ['In Safari’s menu bar, choose File, then Add to Dock.', 'Keep the Joe’s Lotto name and choose Add.', 'Open the icon from your Dock. If your saved records do not appear, restore a JSON backup from the browser you used before.'],
      card: 'Give Joe’s Lotto its own app window and a place in your Dock.',
      label: 'Add to Dock'
    };
    return {
      title: 'Install Joe’s Lotto.',
      intro: 'Keep the app close with its own icon and window. Chrome supports installation on Mac and other computers.',
      steps: ['Open this page in Chrome.', 'Open the ⋮ menu, then Cast, save and share, then Install page as app. You may also see an install icon beside the address bar.', 'Confirm Install, then open Joe’s Lotto from your apps. On Android, use Chrome’s Install and create shortcut or Add to Home screen option.'],
      card: 'Keep Joe’s Lotto close with its own app icon and window.',
      label: 'Install Joe’s Lotto'
    };
  }

  function render() {
    const copy = platformCopy();
    const card = byId('installCard');
    if (card) card.hidden = installed || isAppWindow() || dismissedForVisit;
    if (byId('installCardCopy')) byId('installCardCopy').textContent = copy.card;
    if (byId('installTitle')) byId('installTitle').textContent = copy.title;
    if (byId('installIntro')) byId('installIntro').textContent = copy.intro;
    if (byId('installSteps')) {
      byId('installSteps').replaceChildren(...copy.steps.map(text => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }));
    }
    if (byId('installAppLink')) byId('installAppLink').value = appURL();
    if (byId('installNative')) byId('installNative').hidden = !deferredPrompt || installed || isAppWindow();
    if (byId('installManual')) byId('installManual').hidden = installed || isAppWindow();
    if (byId('installDataNote')) byId('installDataNote').hidden = false;
    document.querySelectorAll('[data-action="install-app"]').forEach(button => {
      button.disabled = installing;
      if (button.id !== 'installNative') button.textContent = installing ? 'Opening install…' : accepted ? 'Installation help' : deferredPrompt ? 'Install Joe’s Lotto' : copy.label;
    });
    document.querySelectorAll('[data-install-settings-label]').forEach(label => { label.textContent = installed || isAppWindow() ? 'App installed' : 'Install Joe’s Lotto'; });
    const status = byId('installStatus');
    if (status) {
      status.textContent = notice;
      status.hidden = !notice;
    }
  }

  function openHelp() {
    render();
    const dialog = byId('installDialog');
    if (!dialog) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
  }

  async function requestInstall() {
    if (installing) return;
    if (installed || isAppWindow() || !deferredPrompt) {
      openHelp();
      return;
    }
    // prompt() must run directly in this user click, before any other await.
    const event = deferredPrompt;
    deferredPrompt = null;
    installing = true;
    notice = '';
    render();
    try {
      const prompted = await event.prompt();
      const result = prompted?.outcome ? prompted : await event.userChoice;
      if (result?.outcome === 'accepted') {
        accepted = true;
        notice = 'Installation accepted. Follow any remaining device or browser instructions, then open the Joe’s Lotto icon.';
      } else {
        notice = 'No problem. You can install later from your browser’s menu. Your saved tickets are still here.';
        openHelp();
      }
    } catch {
      notice = 'The browser could not open its install screen. Use the steps below to install from its menu.';
      openHelp();
    } finally {
      installing = false;
      render();
    }
  }

  async function copyLink() {
    const field = byId('installAppLink');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(appURL());
      notice = android ? 'App link copied. Paste it into Chrome on your Android phone.' : 'App link copied. Open it in the browser you want to use for Joe’s Lotto.';
    } catch {
      notice = android || ios ? 'Press and hold the link to copy it, then open it in your browser.' : 'Select and copy the link below, then open it in your browser.';
      if (field) { field.focus(); field.select(); }
    }
    render();
  }

  async function checkInstalledApp() {
    if (checkingInstalled || typeof navigator.getInstalledRelatedApps !== 'function') return;
    checkingInstalled = true;
    try {
      // The manifest declares only this app. This API cannot enumerate other apps.
      const related = await navigator.getInstalledRelatedApps();
      const manifestURL = new URL('./manifest.webmanifest', document.baseURI).href;
      if (Array.isArray(related) && related.some(app => {
        if (app.platform !== 'webapp') return false;
        try { return new URL(app.url, document.baseURI).href === manifestURL; }
        catch { return false; }
      })) {
        installed = true;
        deferredPrompt = null;
        render();
      }
    } catch {
      // Unsupported or restricted browsers still have manual installation help.
    } finally {
      checkingInstalled = false;
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    if (typeof event.prompt !== 'function') return;
    event.preventDefault();
    deferredPrompt = event;
    accepted = false;
    dismissedForVisit = false;
    notice = '';
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    accepted = false;
    deferredPrompt = null;
    notice = 'Joe’s Lotto is installed. Look for its green icon in your apps or on your home screen.';
    render();
  });
  modes.forEach(mode => {
    const changed = () => { if (isAppWindow()) deferredPrompt = null; render(); };
    if (typeof mode.addEventListener === 'function') mode.addEventListener('change', changed);
    else if (typeof mode.addListener === 'function') mode.addListener(changed);
  });
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!button) return;
    switch (button.dataset.action) {
      case 'install-app': requestInstall(); break;
      case 'open-install': openHelp(); break;
      case 'close-install': byId('installDialog')?.close(); break;
      case 'copy-install-link': copyLink(); break;
      case 'dismiss-install': dismissedForVisit = true; render(); break;
      default: break;
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkInstalledApp(); });

  function init() {
    const dialog = byId('installDialog');
    if (dialog) {
      dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
      });
    }
    render();
    checkInstalledApp();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.JoeInstall = Object.freeze({ open: openHelp, refresh: render, getState: () => ({ installed: installed || isAppWindow(), promptAvailable: !!deferredPrompt, installing, accepted }) });
})();
