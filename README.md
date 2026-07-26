# LLM Email Assistant

An automated email responder: when an email arrives at a dedicated Gmail
address, the system generates a contextual reply with Google's Gemini API
(free tier) and sends it back to the sender — politely asking if there is
anything else they need assistance with. A small web dashboard shows the
contacts and the full message log.

Built for the "LLM-Powered Email Automation" challenge (Option B).

## How it works

````
sender ──► Gmail INBOX ──► listener (IMAP IDLE + 60s safety-net poll)
                              │
                              ├─ loop protection (RFC 3834 headers, no-reply senders)
                              ├─ Gemini generates a contextual reply
                              ├─ reply sent via Gmail SMTP, threaded (In-Reply-To)
                              └─ contact + both messages logged to SQLite
                                                  │
                                   Next.js dashboard (reads the same DB)
````

The trigger is push-based: the listener holds an IMAP connection to Gmail in
IDLE mode, so the server notifies it the instant new mail arrives. A
60-second poll acts as a safety net in case a push notification is missed,
guaranteeing every email is answered within a minute at worst.

## Tech stack

- **Runtime:** Node.js + TypeScript (listener run with `tsx`)
- **Email:** `imapflow` (IMAP IDLE trigger), `mailparser` (MIME parsing),
  `nodemailer` (SMTP sending) — a plain Gmail account with an App Password,
  no paid email service required
- **LLM:** Google Gemini (`@google/genai`, `gemini-3.1-flash-lite`) — free
  API key from [Google AI Studio](https://aistudio.google.com)
- **Storage:** SQLite (`better-sqlite3`) with Drizzle ORM, WAL mode so the
  listener (writer) and dashboard (reader) share the database safely
- **Dashboard:** Next.js (App Router, React Server Components, Tailwind CSS)

## Design decisions

- **At-most-once replies.** Messages are marked *Seen* before processing:
  if the process crashes halfway, one reply may be missed, but a sender is
  never spammed with duplicates on restart. For a system talking to humans,
  duplicates are worse than silence.
- **Loop protection.** Auto-generated mail is never answered: RFC 3834's
  `Auto-Submitted`, Microsoft's `X-Auto-Response-Suppress`, `Precedence:
  bulk/junk/list`, `List-Id`, bounce addresses (`mailer-daemon@`), the bot's
  own address, and `no-reply`-style senders are all skipped. This prevents
  infinite bot-to-bot exchanges.
- **Graceful degradation.** If the LLM call fails (quota, network), the
  sender still receives a polite fallback reply — which also ends with the
  required "anything else?" question.
- **Layered architecture.** `lib/db.ts`, `lib/llm.ts` and `lib/email.ts`
  each encapsulate one external system behind a small interface; the
  listener orchestrates them and the dashboard only reads. Swapping the LLM
  provider or the mail transport changes exactly one file.
- **Threading.** Replies echo the original `Message-ID` in
  `In-Reply-To`/`References`, so they nest under the sender's message in
  their mail client.

## Setup

Prerequisites: Node.js 20+, a Gmail account for the bot, a free Gemini key.

1. **Clone and install**

````
   git clone <this repository>
   cd llm_email_assistant
   npm install
````

2. **Gmail App Password** — on the bot account: enable 2-Step Verification,
   then create an App Password (Google Account → Security → App passwords)
   and keep the 16-character code. IMAP must be enabled (Gmail Settings →
   Forwarding and POP/IMAP).

3. **Gemini key** — create a free API key at
   [Google AI Studio](https://aistudio.google.com) (no credit card).

4. **Configuration** — copy `.env.example` to `.env` and fill in:

````
   GMAIL_ADDRESS=your-bot@gmail.com
   GMAIL_APP_PASSWORD=your-16-char-app-password
   GEMINI_API_KEY=your-gemini-api-key
   ASSISTANT_NAME=Email Assistant
````

5. **Run** — two terminals:

````
   npm run listener   # the responder (creates the DB tables on first run)
   npm run dev        # the dashboard at http://localhost:3000
````

Send an email to the bot's address and a contextual reply arrives in the
same thread within seconds; the dashboard shows the contact and both
messages after a refresh.

## Proof

| Dashboard | Reply thread | Listener terminal |
|---|---|---|
| ![dashboard](docs/screenshots/dashboard.png) | ![reply](docs/screenshots/reply-thread.png) | ![terminal](docs/screenshots/terminal.png) |

## Project structure

````
lib/
  types.ts                   shared data shapes
  db.ts                      SQLite schema + connection + query helpers
  email.ts                   Gmail SMTP sending (nodemailer)
  llm.ts                     Gemini wrapper
  prompts/inbound-assistant.ts   system prompt (task requirements live here)
scripts/
  listener.ts                IMAP trigger + orchestration
components/
  ContactList.tsx, EmailLog.tsx  dashboard presentation
app/
  page.tsx                   dashboard page (reads the DB directly)
drizzle.config.ts            drizzle-kit configuration
````

## Known limitations

- **First-contact spam filtering.** Gmail may route the very first message
  from an unknown sender to Spam (observed during testing); the listener
  watches INBOX only. Marking the sender "not spam" (or a filter) fixes it
  permanently for that sender.
- **No conversation memory.** Each email is answered on its own; quoted
  history in the body is deliberately ignored by the prompt.
- **Dashboard refresh.** The page re-reads the database per request; there
  is no live push to the browser.
- **Gmail sending limits.** A personal Gmail account is rate-limited
  (~500 recipients/day) — fine for an assistant, not a bulk-mail tool.
````
````

