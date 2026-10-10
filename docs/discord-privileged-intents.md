# Discord privileged intents

Discord gates three gateway intents — **Server Members** (`GuildMembers`),
**Presence** (`GuildPresences`) and **Message Content** (`MessageContent`) —
behind a review once an app can be seen by more than 10,000 unique users
(the rule since 2026-06-10; it used to be 100 servers). Lupos is past it:
about 19,800 users across 7 servers, Whitemane Forever alone about 15,100.

## Status

- **2026-10-09, ~18:00 UTC:** the review request had not been submitted by
  the extended deadline, and Discord removed all three. It closed the
  session with 4014 ("Disallowed intent(s)"). discord.js never retries a
  4014, so Lupos heard nothing for eight hours while its process, HTTP API
  and jobs kept the container "healthy". The application flags read
  `18874368` (bits 21 and 24, none of the gateway bits).
- **Since `discord-intents-fallback`:** Lupos reads its application flags
  before every login and connects with only the intents they grant. **When
  Discord approves an intent, restart the container — no code change.** A
  4014 mid-session restarts the process; one at boot does not (a restart
  would get the same answer and burn the daily session budget). The
  heartbeat pages through the portal watchdog when the gateway has been
  down for five minutes, and `/health` shows `gatewayDownSince`.
- **Check what is granted:** `GET /applications/@me` with the bot token;
  in `flags`, bits 12/13 = Presence, 14/15 = Server Members, 18/19 =
  Message Content (the plain bit once approved through review, the
  `_LIMITED` one under the portal toggle). The boot log names any intent
  that is withheld.

## What each intent powers

| Intent | Powers | Without it |
| --- | --- | --- |
| Server Members | Join screening: accounts under four weeks old are kicked, a #politics mute is re-applied on rejoin, birthdays re-synced. Role-combination kick for new accounts. Onboarding completion: role-picker refresh, birthday DM prompt. #leavers log. Moderator sweeps (age purge, combo backfill, role revoke). Dashboard member list; the role jobs' view of who holds yapper / overreactor / birthday. | No join, update or leave events: no screening, onboarding prompt or leave log. Sweeps refuse at once. The dashboard serves cached members. An activity role may stay on a previous holder Lupos has not seen since boot. |
| Presence | Game roles from "now playing", Twitch live notifications and the streamer role in #streamers, `GameActivity` stats, presence lines in Lupos's prompt, dashboard status. | All of it stops quietly. |
| Message Content | Answering his name ("Lupos, …") and ping-off replies, ambient chime-ins, jukebox text commands, the `Messages` archive's content and media, deleted / edited message logs, the laugh-only rule, reaction highlights, other people's messages in his conversation context, conversation summaries. | Lupos still answers @-mentions, replies with the ping on, slash commands and buttons — Discord sends content for those, DMs and his own messages only. Other people's messages are blank, so his context is too. The archive stores metadata and marks new documents `contentWithheld: true` (the rescrape mode can fill them in once access is back); it never blanks content it already holds. |

## What the review asks for

Sources: Discord's
[Getting Started with Privileged Intent Review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review),
the Developer Terms §5 and Developer Policy (effective 2024-07-08, the last
full text published in `discord/discord-api-docs`), and one developer's
[account of four 2026 rejections](https://www.zikeji.com/2026/07/21/seven-years-three-rejections-and-counting-the-discord-privileged-intent-saga/).

1. **A use case per intent**, specific, and why interactions (slash
   commands, buttons, @-mentions) cannot replace it. Answers are reported
   to be capped at 2,000 characters. The stated denial reasons: the use
   case does not require the intent, interactions could do it, the
   submission is unclear, or the use violates policy.
2. **Data handling:** what is stored, why, the retention policy and the
   security measures — or that data is processed in memory and discarded.
3. **A public privacy policy at a stable URL.** The form asks whether one
   exists, and the first rejection in the account above was for its
   absence. Terms §5(a): it must describe what is collected, how it is
   used and shared (third parties included) and how users request
   deletion. **Lupos's app has no privacy policy URL set.**
4. **A deletion path.** Terms §5(b): delete data once it is no longer
   needed for the stated functionality, or when the user or Discord asks,
   and give users "an easily accessible way" to ask. **Lupos keeps
   everything indefinitely, and a deleted message is only soft-deleted
   (`isDeleted`).**
5. **Policy fit**, which the reviewer can check against what the app does:
   - Policy 20, "Do not mine or scrape any data … available on or through
     Discord": the 8.7 million-message archive and the clone / rescrape
     modes that page channel history into it.
   - Policy 16, "Do not use API Data to profile Discord users":
     `UserConversationSummaries` (76,000 per-user documents).
   - Policy 5, "Do not contact users on Discord without their explicit
     permission": the July 2026 invite campaign (3,848 DMs to members of
     another server, enumerated with Server Members; finished).
   - Terms §5(b) on sharing: message content reaches model providers
     through Prism — Gemini for replies, an OpenAI model for the ambient
     classifier, ElevenLabs for voiced replies — which must be bound as
     service providers and named in the privacy policy.
   - Terms §5(c): encryption at rest for stored API Data (Mongo and MinIO
     on the NAS — unconfirmed).
6. **Denials cover the whole request.** The rejections quoted in the
   account above read: "Denials apply to your whole request, not to
   individual intents. There is no partial approval." An intent with a
   weak case can sink one with a strong case.

After a missed deadline, a request can still be filed at any time.
Discord's promise that access continues during review covers apps that
still hold the intents, so Lupos runs without them until approval. No
turnaround time is published. Approved apps reapply every year.

## Recommendation

- **Request Server Members on its own.** Its uses are the moderation
  Discord names as the typical case, they run on events no interaction
  provides, and they store almost nothing.
- **Drop Presence.** Twitch's EventSub can announce streams for the
  members who link a channel, and game roles can be self-assigned in
  Onboarding or the role picker.
- **Message Content only as a separate, later request**, and only once the
  archive's retention, hard deletion and scraping modes have been settled —
  as it stands, the honest data-handling answer is the case against it.

## Draft: Server Members use case

Lupos is the community bot of Whitemane Forever, a World of Warcraft
server of about 15,000 members, and a few smaller servers. Server Members
powers moderation that acts on member events, not on anything a member
sends to the bot, so interactions cannot replace it:

1. Join screening (GUILD_MEMBER_ADD): accounts younger than four weeks are
   removed on join, the usual source of raid and alt accounts; a member
   muted from our politics channel who leaves and rejoins gets the mute
   back instead of evading it.
2. Onboarding (GUILD_MEMBER_UPDATE): when a member completes Community
   Onboarding, Lupos repeats the join screening, refreshes the role-picker
   message and sends a one-time opt-in birthday prompt.
3. Role screening (GUILD_MEMBER_UPDATE): a new account that takes a
   specific pair of onboarding roles in its first four weeks, the pattern
   our spam accounts follow, is removed.
4. Leave log (GUILD_MEMBER_REMOVE): moderators see who left, when they
   joined and which roles they held.
5. Moderator sweeps, run by hand and dry-run by default, apply rules 1
   and 3 to existing members, which needs the member list.

Data: member events are processed in memory. We keep only the moderation
outcome in our logs (user ID, rule, time) and, if the member opts in
through the button prompt, their birthday. Nothing from these events is
shared with third parties.

(About 1,400 characters. Before submitting: publish the privacy policy,
set its URL in the Developer Portal under General Information, and state a
log retention period here.)
