/**
 * lib/email.ts — the outbound side: sending mail through Gmail's SMTP server.
 *
 * SMTP (Simple Mail Transfer Protocol) is the standard protocol for SENDING
 * email. nodemailer is the de-facto Node.js library for speaking it.
 * Everything sending-related is contained here (encapsulation, again): the
 * listener just calls sendAssistantReplyEmail() and knows nothing about SMTP.
 */

import nodemailer, {type Transporter} from "nodemailer";
import type {AssistantReplyEmailParams} from "./types"; // relative: same folder

// ---------------------------------------------------------------------------
// The transporter — nodemailer's reusable object holding the authenticated
// connection settings to one SMTP server. Built once, reused for every send
// (singleton + lazy initialization, same pattern as lib/llm.ts).
// ---------------------------------------------------------------------------

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
    if (!transporter) {
        const user = process.env.GMAIL_ADDRESS;
        // Defensive cleanup: Google displays the app password in groups
        // ("abcd efgh …"); if spaces were pasted into .env, strip them here
        // rather than fail authentication mysteriously.
        const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
        if (!user || !pass) {
            throw new Error("GMAIL_ADDRESS or GMAIL_APP_PASSWORD is not set");
        }
        transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",  // Google's SMTP server
            port: 465,               // 465 = "implicit TLS": encrypted from the
            secure: true,            //       very first byte of the connection
            // Authentication uses the 16-character App Password — NEVER the
            // account's real password. Revocable independently if it leaks.
            auth: {user, pass},
        });
    }
    return transporter;
}

// ---------------------------------------------------------------------------
// The From field. `"Email Assistant" <bot@gmail.com>` is the standard format:
// display name in quotes, address in angle brackets — inboxes then show the
// friendly name instead of the bare address.
// ---------------------------------------------------------------------------

function fromField(): string {
    const address = process.env.GMAIL_ADDRESS;
    if (!address) throw new Error("GMAIL_ADDRESS is not set");
    const name = process.env.ASSISTANT_NAME?.trim() || "Email Assistant";
    return `"${name}" <${address}>`;
}

/**
 * Send the AI-generated reply back to the original sender.
 *
 * Threading: every email carries a globally unique Message-ID header. By
 * echoing the ORIGINAL message's ID in our In-Reply-To and References
 * headers (nodemailer's inReplyTo/references options), the sender's mail
 * client recognizes the reply as part of the same conversation and nests
 * it under their message instead of showing a disconnected new email.
 */
export async function sendAssistantReplyEmail(
    args: AssistantReplyEmailParams
): Promise<void> {
    await getTransporter().sendMail({
        from: fromField(),
        to: args.to,               // the original sender becomes the recipient
        subject: args.subject,     // "Re: …" — prefixed by the caller
        text: args.textBody,       // plain text, matching our prompt's rules
        inReplyTo: args.messageId,
        references: args.messageId,
    });
}