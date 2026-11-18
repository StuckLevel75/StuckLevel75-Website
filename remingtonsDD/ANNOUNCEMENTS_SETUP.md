# Digital Den Announcements deployment

Admin page: https://stucklevel75.com/remingtonsDD/Admin/Announcements/

This feature uses the existing Firebase administrator sign-in and the existing Cloudflare Worker. No Discord OAuth is required for administrators.

## Deployment steps

1. Merge the GitHub PR and wait for GitHub Pages to deploy.
2. In Cloudflare, open Worker `digital-den-auth`, replace its code with the **complete** contents of `remingtonsDD/cloudflare/worker.js` from `main`, then Deploy. GitHub does **not** automatically deploy this Worker.
3. Confirm the existing Worker secret `DISCORD_BOT_TOKEN` is still configured.
4. In Discord, give the bot View Channel, Send Messages, and Embed Links permissions in both channels:
   - Public announcements: `1572372341806338219`
   - Private staff updates: `1572372383161909290`
5. Ensure the staff channel is private through Discord channel permission settings.
6. Sign into the admin page and test with a **draft first**, then publish a harmless test message in the staff channel.

## Behavior

- Drafts and history are stored in Firestore collection `digitalDenAnnouncements` using the Worker's Firebase service account; the browser never directly writes to that collection.
- The Worker verifies Firebase administrator ID tokens for every action and limits Discord messages to the two hardcoded channel IDs.
- Published announcements can be edited in the same channel or deleted (which also deletes the Discord message).
- Public announcements can optionally ping `@everyone`; staff messages never ping everyone.
- No Firestore rules update is required; the existing deny-by-default rules keep this collection inaccessible from browsers.
- If Discord succeeds but the Firestore write fails, the message may have posted despite an error. Check the channel before retrying to avoid duplicate posts.
- Discord may require the bot's Mention Everyone permission to send a notification when `@everyone` is selected.
