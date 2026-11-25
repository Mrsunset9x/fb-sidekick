# Contacts Rail for Facebook privacy policy

Contacts Rail has no server, analytics or tracking.

- The Messenger panel is Facebook's own page (`facebook.com/messages`), loaded by your browser with
  your existing Facebook session.
- The extension reads names, avatars, presence, unread indicators, conversation links, last-message
  previews and relative times already shown in the Messenger inbox. It uses previews in memory for
  the hover card. It does not save previews or send them to a server.
- Chrome local storage holds panel settings, cached Messenger contact rankings (IDs, names and
  avatar URLs), and the time of the last presence notification per opted-in contact. Chrome sync
  stores IDs for pinned, hidden and notification-enabled contacts, and syncs them when extension
  sync is enabled. Chrome session storage temporarily holds the tab and thread needed to open a
  chat from a notification.
- If a deletion fails, Chrome local storage keeps one diagnostic report: extension version, time,
  failure stage, control counts and boolean checks. It contains no names, thread IDs, conversation
  URLs, messages or page HTML. A later failure replaces it; nothing is uploaded. It can be viewed in
  the extension popup under **Latest deletion error details**.
- For an opted-in presence alert, the extension gives the person's name and, when available, their
  avatar to Chrome for display. It requests the avatar from the Facebook-hosted URL in the inbox,
  without credentials, and uses the extension icon if the avatar is unavailable.
- When you confirm **Delete conversation**, the extension uses Facebook's own Messenger controls in
  the docked inbox. Facebook processes the deletion through your existing session. This permanently
  removes your copy of the whole conversation. Other participants keep their copies.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Store panel settings, contact preferences and the ranking and notification data described above. |
| `notifications` | Show Chrome notifications when an opted-in contact comes online. |
| `declarativeNetRequest` | Remove the one header (`X-Frame-Options`) that stops Messenger from being shown inside facebook.com, only for frames facebook.com opens on `facebook.com/messages`. |
| Access to `www.facebook.com`, `web.facebook.com` | Place the panel in Facebook's right column. |

Contacts Rail is not affiliated with or endorsed by Meta Platforms, Inc. Facebook and Messenger are
trademarks of Meta Platforms, Inc.
