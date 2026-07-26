/**
 * scripts/listener.ts — the trigger and orchestrator of the whole system.
 *
 * Connects to Gmail over IMAP and waits for new mail: the server pushes an
 * "exists" notification when mail arrives (IDLE), and a 60-second interval
 * re-checks the mailbox as a safety net in case a push is missed.
 * For every new email:
 *
 *   1. parse the raw message                 (mailparser)
 *   2. loop protection: never answer bots    (RFC 3834 headers, own address)
 *   3. upsert the sender into contacts       (lib/db)
 *   4. generate a contextual reply           (lib/llm  -> Gemini)
 *   5. send it, threaded under the original  (lib/email -> Gmail SMTP)
 *   6. log both messages for the dashboard   (lib/db)
 *
 * Run with:  npm run listener
 */

// Loads the .env file into process.env as a side effect of the import —
// placed first so that every module below finds its variables already set.
import "dotenv/config";

import {ImapFlow} from "imapflow";                        // IMAP client (the trigger)
import {simpleParser, type ParsedMail} from "mailparser"; // raw MIME -> clean fields
// Relative imports: from scripts/, one level up (..) into lib/.
import {saveMessage, upsertContact} from "../lib/db";
import {sendAssistantReplyEmail} from "../lib/email";
import {generateAssistantReply} from "../lib/llm";

// ---------------------------------------------------------------------------
// Configuration checks — fail loudly at startup with a clear message,
// instead of mysteriously later, mid-processing.
// ---------------------------------------------------------------------------

const BOT_ADDRESS = (process.env.GMAIL_ADDRESS ?? "").trim().toLowerCase();
const APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");

if (!BOT_ADDRESS || !APP_PASSWORD) {
    console.error("Missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD in .env — aborting.");
    process.exit(1); // exit code 1 = "ended with an error" (0 means success)
}
if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env — aborting.");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Loop protection.
//
// Replying to another automated sender (out-of-office autoresponder,
// delivery-failure notice, newsletter) can trap two machines in an infinite
// exchange. Automated mail marks itself with standard headers (RFC 3834 and
// common vendor conventions); all of them are checked before any reply.
// Returns a human-readable reason to skip, or null meaning "safe to answer".
// ---------------------------------------------------------------------------

function skipReason(mail: ParsedMail, senderEmail: string): string | null {
    // 1) Mail sent by the bot's own address is never answered.
    if (senderEmail === BOT_ADDRESS) return "message sent by the bot itself";

    // 2) RFC 3834: automatic responders must set Auto-Submitted to a value
    //    other than "no". Header names are lowercase in mailparser's map.
    const auto = mail.headers.get("auto-submitted");
    if (typeof auto === "string" && auto.toLowerCase() !== "no") {
        return `auto-submitted: ${auto}`;
    }

    // 3) Microsoft convention asking bots not to auto-respond.
    if (mail.headers.has("x-auto-response-suppress")) {
        return "x-auto-response-suppress header present";
    }

    // 4) Bulk/list senders set Precedence — never worth an AI reply.
    const precedence = mail.headers.get("precedence");
    if (
        typeof precedence === "string" &&
        ["bulk", "junk", "list", "auto_reply"].includes(precedence.toLowerCase())
    ) {
        return `precedence: ${precedence}`;
    }

    // 5) Mailing lists identify themselves with List-Id.
    if (mail.headers.has("list-id")) return "mailing-list message";

    // 6) Bounce notices arrive from these conventional addresses.
    if (senderEmail.startsWith("mailer-daemon@") || senderEmail.startsWith("postmaster@")) {
        return "delivery notification";
    }

    // 7) Naming convention: many automated senders (Google notifications,
    //    receipts, alerts) carry none of the standard headers above and rely
    //    solely on a "no-reply"-style address. The regex matches the local
    //    part (before the @): no-reply, noreply, do-not-reply, donotreply,
    //    notification(s)@ — case-insensitively, with "-", ".", "_" allowed
    //    as separators. Checked last: the headers above are stronger
    //    evidence of automation than a naming convention.
    if (/^(no[-._]?reply|do[-._]?not[-._]?reply|notifications?)@/i.test(senderEmail)) {
        return "no-reply style sender";
    }

    return null; // human sender — safe to answer
}

// ---------------------------------------------------------------------------
// Handles one parsed email end-to-end (steps 2–6 of the header comment).
// ---------------------------------------------------------------------------

async function handleEmail(mail: ParsedMail): Promise<void> {
    // mailparser shape: mail.from.value is an array of {address, name}.
    // The chain of `?.` (optional chaining) survives any missing level.
    const senderEmail = (mail.from?.value?.[0]?.address ?? "").toLowerCase();
    const displayName = mail.from?.value?.[0]?.name?.trim() || null;
    const subject = mail.subject || "(no subject)";
    const userMessage = (mail.text || "").trim(); // plain-text body
    // Message-ID is globally unique per email. If a client omitted it, a
    // generated one keeps threading and logging functional.
    const messageId = mail.messageId || `<generated-${Date.now()}@local>`;

    // Guard clauses: bad cases are rejected early, keeping the main path flat.
    if (!senderEmail) {
        console.log("[skip] no sender address");
        return;
    }
    const reason = skipReason(mail, senderEmail);
    if (reason) {
        console.log(`[skip] ${senderEmail} — ${reason}`);
        return;
    }
    if (!userMessage) {
        console.log(`[skip] ${senderEmail} — empty body`);
        return;
    }

    console.log(`[inbound] from ${senderEmail} | subject: ${subject}`);

    // Records the sender (insert or refresh) and logs the inbound message.
    await upsertContact(senderEmail, displayName);
    await saveMessage(messageId, "user", userMessage);

    // LLM call. The error POLICY lives here (not in lib/llm.ts): if
    // generation fails (quota, network), the sender still receives a polite
    // answer — and the fallback also asks the required closing question.
    let reply: string;
    try {
        reply = await generateAssistantReply(userMessage);
    } catch (err) {
        console.error("[llm] generation failed", err);
        reply =
            "Thanks for your email! I wasn't able to process your message just now, " +
            "but a human will take a look shortly. Is there anything else I can help you with?";
    }

    // Reply subject: "Re: " is prepended unless already present.
    // toLowerCase() catches "RE:", "re:", "Re:" alike.
    await sendAssistantReplyEmail({
        to: senderEmail,
        subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
        textBody: reply,
        messageId,
    });

    await saveMessage(messageId, "assistant", reply);
    console.log(`[outbound] replied to ${senderEmail}`);
}

// ---------------------------------------------------------------------------
// IMAP side: finds unhandled mail and processes it.
// ---------------------------------------------------------------------------

// Simple lock: if a second trigger fires while a batch is still being
// processed, it returns immediately instead of running concurrently and
// double-answering the same messages. This also guarantees that the "exists"
// push and the 60-second poll below can never process the same mail twice.
let processing = false;

async function processUnseen(client: ImapFlow): Promise<void> {
    if (processing) return;
    processing = true;
    try {
        // IMAP flag "Seen" = read. Every handled message is marked Seen
        // below, so "search unseen" always yields exactly the new, unhandled
        // mail — including mail that arrived while the listener was offline.
        // {uid: true} requests UIDs: stable per-message IDs, unlike sequence
        // numbers, which shift when the mailbox changes.
        const uids = await client.search({seen: false}, {uid: true});
        if (!uids || uids.length === 0) return;

        for (const uid of uids) {
            // Marked Seen first ("at-most-once" delivery): if processing
            // crashes halfway, one reply may be missed, but the sender is
            // never spammed with duplicates on every restart.
            await client.messageFlagsAdd(String(uid), ["\\Seen"], {uid: true});

            // Fetches the complete raw message (headers + body) as bytes.
            const fetched = await client.fetchOne(String(uid), {source: true}, {uid: true});
            if (!fetched || !fetched.source) {
                console.log(`[skip] uid ${uid} — could not fetch source`);
                continue;
            }

            // Parses MIME into a structured object, then handles it. One
            // failing email must never kill the loop for the others: errors
            // are caught per message.
            try {
                const mail = await simpleParser(fetched.source);
                await handleEmail(mail);
            } catch (err) {
                console.error(`[error] processing uid ${uid} failed`, err);
            }
        }
    } finally {
        // `finally` runs on success and on error alike — the lock always
        // releases; otherwise one crash would freeze the listener silently.
        processing = false;
    }
}

// ---------------------------------------------------------------------------
// One IMAP session: connect, catch up, then react to pushes + periodic poll.
// ---------------------------------------------------------------------------

async function runSession(): Promise<void> {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,       // IMAP over TLS (encrypted)
        secure: true,
        auth: {user: BOT_ADDRESS, pass: APP_PASSWORD}, // same App Password as SMTP
        logger: false,   // set to `console` for verbose IMAP protocol logs
    });

    // Registered before connect(): an 'error' event on an EventEmitter with
    // no listener attached would be thrown and kill the process. Logging it
    // lets the reconnect loop in main() handle recovery instead.
    client.on("error", (err) => {
        console.error("[listener] connection error:", err.message);
    });

    await client.connect();
    await client.mailboxOpen("INBOX");
    console.log(`[listener] connected as ${BOT_ADDRESS}, waiting for mail…`);

    // Catch-up: anything that arrived while the listener was offline.
    await processUnseen(client);

    // Primary trigger: "exists" fires when the mailbox grows — i.e. new mail
    // arrived. Between commands, imapflow re-enters IDLE automatically, so
    // these push notifications keep working throughout the session.
    client.on("exists", () => {
        processUnseen(client).catch((err) => console.error("[error]", err));
    });

    // Keep-alive + safety net. The "exists" push above gives near-instant
    // replies when it fires; this interval re-checks the mailbox every 60
    // seconds in case a push notification is missed — so every email is
    // answered within a minute at worst. An active interval timer is also
    // real scheduled work for Node's event loop, which keeps the process
    // alive on its own (a merely pending Promise is not — the cause of an
    // earlier silent-exit bug). Thanks to the `processing` lock, an
    // overlapping push and poll can never process the same message twice.
    const poll = setInterval(() => {
        processUnseen(client).catch((err) => console.error("[error]", err));
    }, 60_000);

    // Resolves only when the connection drops; the timer is then cleared and
    // control returns to the reconnect loop in main(). (This pending Promise
    // alone would not keep the process alive — the interval above does.
    // Clearing the timer matters: a leftover interval would keep firing
    // against a dead connection while main() opens a new one.)
    await new Promise<void>((resolve) => client.on("close", () => resolve()));
    clearInterval(poll);
}

async function main(): Promise<void> {
    // Gmail routinely drops long-lived connections; a resilient listener
    // treats that as normal operation — reconnect forever.
    for (;;) { // idiomatic "loop forever"
        try {
            await runSession();
        } catch (err) {
            console.error("[listener] session ended:", (err as Error).message);
        }
        console.log("[listener] reconnecting in 10s…");
        await new Promise((r) => setTimeout(r, 10_000)); // pause 10 s, then retry
    }
}

main();