const logoutHeading = document.getElementById('logout-heading');
const logoutStatus = document.getElementById('logout-status');
const logoutButton = document.getElementById('logout-button');
let logoutPending = false;

async function signOutHarbor() {
  if (logoutPending) return;
  logoutPending = true;
  logoutHeading.textContent = 'Signing out of Harbor…';
  logoutStatus.textContent = 'Closing your session securely.';
  logoutButton.disabled = true;
  logoutButton.textContent = 'Signing out…';
  try {
    const response = await fetch('/api/auth/logout', {method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},credentials:'same-origin',body:'{}'});
    if (!response.ok) throw new Error('Sign out could not be completed.');
    window.location.replace('/login');
  } catch {
    logoutHeading.textContent = 'Let’s try that again.';
    logoutStatus.textContent = 'We couldn’t close your session. Check your connection, then try signing out again.';
    logoutButton.disabled = false;
    logoutButton.textContent = 'Try signing out again';
    logoutPending = false;
  }
}

// Visiting this page never revokes a session; a deliberate button click sends the POST.
logoutButton?.addEventListener('click', signOutHarbor);
