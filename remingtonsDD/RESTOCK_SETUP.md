# Discord-only Restock Requests

This feature runs through the existing `digital-den-auth` Cloudflare Worker. Staff do not use a website form.

## One-time setup

1. Deploy the complete latest `remingtonsDD/cloudflare/worker.js` to the existing Cloudflare Worker `digital-den-auth`. GitHub Pages does not deploy Cloudflare Worker code.
2. Open https://discord.com/developers/applications and select the existing Digital Den Support bot application.
3. In **General Information**, copy the **Public Key**. In Cloudflare Worker Settings > Variables and Secrets, create a text variable named `DISCORD_PUBLIC_KEY` with that exact value. This is the public key, **not the bot token**.
4. In the Discord developer application's **General Information**, set **Interactions Endpoint URL** to `https://digital-den-auth.dburghagen.workers.dev/discord/interactions` and save. Discord sends a signed PING; the Worker verifies it and responds. If Discord rejects the URL, verify the Worker deployment and public key.
5. Open https://stucklevel75.com/remingtonsDD/Admin/Announcements/ and sign in with your existing admin login. Click **Post Restock Button**. This posts a panel in the existing private Restock channel (`1572372357748891648`). Do this once, or repeat to create a new panel.

## Staff workflow

- Staff click **Request Restock** in Restock.
- A Discord modal asks for only **Item to restock**.
- Submitting posts a new request in the same channel.
- Managers (role `1572372322092974154`) or users with Discord Administrator permission can **Approve**, **Deny**, or **Restocked**.
- A request must be approved before it can be marked restocked. Denied/restocked requests cannot be changed.
- Requests are stored in Firestore collection `digitalDenRestockRequests` through the Worker; no new Firestore browser rules are required.
- Existing bot administrator permission is sufficient.

## Important

- Discord's interactions endpoint must be configured in the Discord Developer Portal. Bot messages sent via REST alone cannot receive interactive button/modal events.
- If the Worker is offline or its public key is wrong, buttons won't work.
- The existing bot token remains a Cloudflare secret; never paste it into the website or a public repository.

When a manager clicks **Restocked** on an approved request, the bot deletes the request message from the Restock channel and retains its completed status in Firestore. The button panel stays in the channel.
