import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from '/firebase-config.js';

const $ = id => document.getElementById(id);
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app);
const adminUid = 'Bm2XwQBXXEePFaaMfLs5K5ck0HB2';
const states = ['new', 'contacted', 'closed'];
let stop = null, records = [];

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-button').disabled = true;
  $('login-status').textContent = 'Signing in…';
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    $('password').value = '';
  } catch (error) {
    $('login-status').textContent = 'Sign-in failed. Check your credentials.';
  } finally { $('login-button').disabled = false; }
});
$('logout').addEventListener('click', () => signOut(auth));
$('filter').addEventListener('change', render);

function field(dl, label, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value || '—';
  dl.append(dt, dd);
}

function render() {
  const visible = records.filter(item => $('filter').value === 'all' || (item.status || 'new') === $('filter').value);
  $('inquiry-list').replaceChildren();
  $('inbox-status').textContent = visible.length ? visible.length + ' inquiries shown' : 'No inquiries in this category.';
  for (const item of visible) {
    const card = document.createElement('article'); card.className = 'inquiry';
    const title = document.createElement('h2'); title.textContent = item.businessName || 'Business inquiry';
    const meta = document.createElement('p'); meta.className = 'meta';
    meta.textContent = (item.createdAt?.toDate?.().toLocaleString() || 'Date unavailable') + ' · ' + (item.status || 'new').toUpperCase();
    const dl = document.createElement('dl');
    field(dl, 'Contact name', item.contactName); field(dl, 'Discord username', item.discord); field(dl, 'Message', item.message);
    const actions = document.createElement('div'); actions.className = 'actions';
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Status for ' + (item.businessName || 'inquiry'));
    for (const value of states) {
      const option = document.createElement('option'); option.value = value; option.textContent = value[0].toUpperCase() + value.slice(1); select.append(option);
    }
    select.value = states.includes(item.status) ? item.status : 'new';
    const save = document.createElement('button'); save.textContent = 'Save status';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await updateDoc(doc(db, 'partnershipInquiries', item.id), {status: select.value, reviewedAt: serverTimestamp()});
        if (auth.currentUser?.uid === adminUid) $('inbox-status').textContent = 'Inquiry updated.';
      } catch (error) { if (auth.currentUser?.uid === adminUid) $('inbox-status').textContent = 'Could not save. Please try again.'; }
      finally { save.disabled = false; }
    });
    actions.append(select, save); card.append(title, meta, dl, actions); $('inquiry-list').append(card);
  }
}

onAuthStateChanged(auth, user => {
  stop?.(); stop = null; records = [];
  // Clear private data on every identity transition, including sign-out.
  $('inquiry-list').replaceChildren();
  const allowed = user?.uid === adminUid;
  $('login').classList.toggle('hidden', allowed);
  $('dashboard').classList.toggle('hidden', !allowed);
  $('login-status').textContent = user && !allowed ? 'This account does not have management access.' : '';
  if (!allowed) return;
  $('inbox-status').textContent = 'Loading inquiries…';
  const expectedUid = user.uid;
  stop = onSnapshot(query(collection(db, 'partnershipInquiries'), where('businessId', '==', 'digital-den')), snapshot => {
    if (auth.currentUser?.uid !== expectedUid) return;
    records = snapshot.docs.map(item => ({...item.data(), id: item.id})).sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    render();
  }, () => { if (auth.currentUser?.uid === expectedUid) $('inbox-status').textContent = 'Unable to load inquiries. Check that the updated Firestore rules are published.'; });
});
