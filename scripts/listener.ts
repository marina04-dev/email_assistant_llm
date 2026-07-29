import "dotenv/config";

import {ImapFlow} from "imapflow";                        
import {simpleParser, type ParsedMail} from "mailparser"; 
import {saveMessage, upsertContact} from "../lib/db";
import {sendAssistantReplyEmail} from "../lib/email";
import {generateAssistantReply} from "../lib/llm";


const BOT_ADDRESS = (process.env.GMAIL_ADDRESS ?? "").trim().toLowerCase();
const APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");

if (!BOT_ADDRESS || !APP_PASSWORD) {
    console.error("Missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD in .env — aborting.");
    process.exit(1); 
}
if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env — aborting.");
    process.exit(1);
}


function skipReason(mail: ParsedMail, senderEmail: string): string | null {
    // 1) Mail sent by the bot's own address is never answered.
    if (senderEmail === BOT_ADDRESS) return "message sent by the bot itself";

    // 2) RFC 3834: automatic responders must set Auto-Submitted to a value
    //    other than "no". 
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
    const senderEmail = (mail.from?.value?.[0]?.address ?? "").toLowerCase();
    const displayName = mail.from?.value?.[0]?.name?.trim() || null;
    const subject = mail.subject || "(no subject)";
    const userMessage = (mail.text || "").trim(); // plain-text body
    const messageId = mail.messageId || `<generated-${Date.now()}@local>`;

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

    // LLM call. The error POLICY is handled here: if
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

    await sendAssistantReplyEmail({
        to: senderEmail,
        subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
        textBody: reply,
        messageId,
    });

    await saveMessage(messageId, "assistant", reply);
    console.log(`[outbound] replied to ${senderEmail}`);
}


let processing = false;

async function processUnseen(client: ImapFlow): Promise<void> {
    if (processing) return;
    processing = true;
    try {
        const uids = await client.search({seen: false}, {uid: true});
        if (!uids || uids.length === 0) return;

        for (const uid of uids) {
            await client.messageFlagsAdd(String(uid), ["\\Seen"], {uid: true});

            // Fetches the complete raw message (headers + body) as bytes.
            const fetched = await client.fetchOne(String(uid), {source: true}, {uid: true});
            if (!fetched || !fetched.source) {
                console.log(`[skip] uid ${uid} — could not fetch source`);
                continue;
            }

            // Parses MIME into a structured object, then handles it. 
            try {
                const mail = await simpleParser(fetched.source);
                await handleEmail(mail);
            } catch (err) {
                console.error(`[error] processing uid ${uid} failed`, err);
            }
        }
    } finally {
        processing = false;
    }
}


async function runSession(): Promise<void> {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,       
        secure: true,
        auth: {user: BOT_ADDRESS, pass: APP_PASSWORD}, 
        logger: false,   
    });


    client.on("error", (err) => {
        console.error("[listener] connection error:", err.message);
    });

    await client.connect();
    await client.mailboxOpen("INBOX");
    console.log(`[listener] connected as ${BOT_ADDRESS}, waiting for mail…`);

    await processUnseen(client);

    // Primary trigger: "exists" fires when the mailbox grows — i.e. new mail
    // arrived. 
    client.on("exists", () => {
        processUnseen(client).catch((err) => console.error("[error]", err));
    });

    
    const poll = setInterval(() => {
        processUnseen(client).catch((err) => console.error("[error]", err));
    }, 60_000);

    
    await new Promise<void>((resolve) => client.on("close", () => resolve()));
    clearInterval(poll);
}

async function main(): Promise<void> {
    for (;;) { 
        try {
            await runSession();
        } catch (err) {
            console.error("[listener] session ended:", (err as Error).message);
        }
        console.log("[listener] reconnecting in 10s…");
        await new Promise((r) => setTimeout(r, 10_000)); 
    }
}

main();