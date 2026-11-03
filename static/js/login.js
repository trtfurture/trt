(function () {
  'use strict';
  const form = document.getElementById('loginForm');
  if (!form) return;
  const errorBox = document.getElementById('loginError');
  const button = form.querySelector('button[type="submit"]');

  async function makeOfflineRecord(name, password) {
    if (!window.crypto || !crypto.subtle) return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(`${name}\u0000${password}`), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material, 256);
    const toHex = bytes => Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('pea-offline-auth-v1', JSON.stringify({ name, salt: toHex(salt), hash: toHex(new Uint8Array(bits)), iterations: 210000 }));
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    button.querySelector('span').textContent = 'Checking access…';
    try {
      const data = new FormData(form);
      const response = await fetch('/login', { method: 'POST', body: data, credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Sign-in failed.');
      const name = String(data.get('admin_name') || '').trim();
      const password = String(data.get('admin_password') || '');
      try { await makeOfflineRecord(name, password); } catch (_) { /* Online sign-in remains available without offline unlock. */ }
      window.location.assign(result.next || '/');
    } catch (error) {
      errorBox.textContent = error.message || 'Could not sign in. Check your connection and try again.';
      button.disabled = false;
      button.querySelector('span').textContent = 'Enter PEA Studio';
    }
  });
})();
