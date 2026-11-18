const $ = id => document.getElementById(id);
const form = $('partnership-form'), status = $('contact-status'), send = $('send-inquiry');
const worker = 'https://digital-den-auth.dburghagen.workers.dev';
let token = sessionStorage.getItem('dd_contact_token') || '';
const params = new URLSearchParams(location.hash.slice(1));
if (params.has('dd_token')) {
  token = params.get('dd_token') || '';
  sessionStorage.setItem('dd_contact_token', token);
  history.replaceState(null, '', location.pathname + location.search);
}
if (location.hash === '#discord-not-member') {
  token = '';
  sessionStorage.removeItem('dd_contact_token');
  history.replaceState(null, '', location.pathname + location.search);
  $('discord-verify-status').textContent = 'Join our Discord server, then verify again.';
}
function refresh() {
  send.disabled = !token;
  if (token) $('discord-verify-status').textContent = 'Discord verified. You can send your inquiry.';
}
refresh();
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!token || $('contact-website').value) return;
  const inquiry = {
    businessName: $('business-name').value.trim(),
    contactName: $('contact-name').value.trim(),
    discord: $('discord-contact').value.trim(),
    message: $('partnership-message').value.trim()
  };
  if (!form.reportValidity()) return;
  send.disabled = true;
  status.textContent = 'Sending your inquiry…';
  try {
    const response = await fetch(worker + '/contact', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token, inquiry})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not send inquiry');
    form.reset();
    token = '';
    sessionStorage.removeItem('dd_contact_token');
    send.textContent = 'Inquiry sent';
    status.textContent = 'Message sent. Management will follow up with you on Discord.';
  } catch (error) {
    status.textContent = error.message || 'Could not send inquiry. Try again.';
    if (/expired/i.test(status.textContent)) {
      token = '';
      sessionStorage.removeItem('dd_contact_token');
    }
    refresh();
  }
});
