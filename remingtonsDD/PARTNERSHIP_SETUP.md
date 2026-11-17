# Digital Den partnership contact

Public page: `/remingtonsDD/Partnerships/`.
Private review inbox: `/remingtonsDD/Admin/Partnerships/`.

The contact page collects business name, character/contact name, Discord username and a message. It saves a `partnershipInquiries/digital-den_<firebase uid>` document with a server timestamp and `new` status. One initial enquiry is accepted per Firebase identity (normally per browser). Follow-up takes place on Discord. Clearing browser identity can bypass that lightweight duplicate limit; this is not strong anti-spam protection.

Only the existing configured administrator can read enquiries and set their status to New, Contacted or Closed. Anonymous visitors cannot read, overwrite or delete them. Firestore rules enforce privacy, identity, field allowlists, lengths and server timestamps. The client renders all user-supplied content using `textContent`.

## Deploy

1. Merge the partnership feature branch through its pull request. GitHub Pages publishes the static pages using the repository's existing configuration.
2. Publish the updated **complete** root `firestore.rules` in the Firebase project's Firestore Rules editor. Do not replace existing rules with only the new collection block. Until these rules are published, contact submissions are rejected. Merging this repository does not deploy Firestore rules automatically.
3. Use the separately supplied, current `Remingtons_DD_Upgrade_Pack.zip`. Its Discord upgrade notebook updates the partnerships channel panel to link to the new contact page.
4. Replace the earlier standalone Google Apps Script code with the current `DD_Application_Alerts.gs` from the pack, keeping `DISCORD_WEBHOOK_URL` in Script properties. Run `installDDAlerts` again to add partnership checks. The existing job-application cursor is retained; partnerships have a separate cursor. No website webhook URL or bot token belongs in this repository.
5. Activate the script before accepting new contacts, then submit a test enquiry. Verify it appears in the private inbox and produces a generic Discord alert mentioning `758805849794805782`. The alert links to the partnership inbox; no message body or Discord contact is posted.

The Google script checks about once a minute, not instantaneously. The laptop can be off. Existing records before first activation are skipped. Both scheduled checks share the existing private notification webhook and use Google/Firebase quotas. Google authorization and live testing are still required; code validation alone does not activate alerts.

## Validation

`node tests/partnerships.test.cjs` exercises trimmed form validation, authentication, the saved payload, duplicate-click prevention, retry after a failed write, admin-only inbox subscription, safe rendering of contact text, filtering, status updates and clearing private data on sign-out. It uses mocked Firebase/DOM APIs, not a live database. Syntax and browser layout checks are separate. Run the Firestore emulator or test deployed rules in a controlled project before relying on production rule enforcement; no live rules deployment is included in this change.
