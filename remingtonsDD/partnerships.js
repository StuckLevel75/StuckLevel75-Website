import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from '/firebase-config.js';

const $ = id => document.getElementById(id);
const form = $('partnership-form'), status = $('contact-status'), send = $('send-inquiry');
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app);
let submitting = false;

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || $('contact-website').value) return;
  const data = {
    businessId: 'digital-den',
    businessName: $('business-name').value.trim(),
    contactName: $('contact-name').value.trim(),
    discord: $('discord-contact').value.trim(),
    message: $('partnership-message').value.trim(),
    status: 'new'
  };
  const limits = [['businessName',2,120], ['contactName',2,80], ['discord',2,120], ['message',10,2000]];
  if (!form.reportValidity() || limits.some(([key,min,max]) => data[key].length < min || data[key].length > max)) {
    status.textContent = 'Please complete each field. Your message needs at least 10 characters.';
    return;
  }
  submitting = true;
  send.disabled = true;
  status.textContent = 'Sending your enquiry…';
  try {
    await auth.authStateReady();
    const user = auth.currentUser || (await signInAnonymously(auth)).user;
    await setDoc(doc(db, 'partnershipInquiries', 'digital-den_' + user.uid), {
      ...data, senderUid: user.uid, createdAt: serverTimestamp()
    });
    form.reset();
    status.textContent = 'Message sent. Management will follow up with you on Discord.';
    // One contact submission per Firebase identity. Keep the form locked after success.
    send.textContent = 'Enquiry sent';
  } catch (error) {
    submitting = false;
    send.disabled = false;
    status.textContent = error.code === 'permission-denied'
      ? 'Unable to send. If you already submitted from this browser, contact staff on Discord for follow-up.'
      : 'Your message could not be sent. Please try again shortly.';
  }
});

// Keep the form unavailable if Firebase modules fail to load.
send.disabled = false;
status.textContent = "";
