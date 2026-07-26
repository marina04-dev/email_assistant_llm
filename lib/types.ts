/**
 * lib/types.ts — the shared data shapes ("type aliases") used across the app.
 *
 * The database layer, the listener, and the dashboard all pass the same kinds
 * of data around. Defining each shape ONCE and importing it everywhere means
 * the compiler enforces that all parts agree — a mismatch becomes a compile
 * error instead of a silent runtime bug.
 *
 * A type alias names a type expression. It produces ZERO runtime JavaScript;
 * it exists purely for compile-time checking. `export` makes it importable
 * by other files (without it, it would be private to this file).
 */

/** One row of the `contacts` table: a person who has emailed the bot. */
export type ContactRow = {
    id: number;                    // auto-incremented primary key
    email: string;                 // unique — one row per sender address
    // `string | null` is a UNION type: the value is one of the alternatives.
    // Senders don't always set a display name, so "might be absent" is made
    // explicit — the compiler now forces every consumer to handle null.
    displayName: string | null;
    firstSeenAt: Date;             // set once, on the sender's first email
    lastSeenAt: Date;              // refreshed on every subsequent email
};

/** One row of the `messages` table: a single logged message. */
export type MessageLogRow = {
    id: number;
    // The glue between an inbound email and its AI reply: both are stored as
    // two rows sharing the same threadId (the original email's Message-ID).
    threadId: string;
    // Union of LITERAL types: not "any string" but exactly one of these two
    // words — a typo like "asistant" anywhere becomes a compile error.
    role: "user" | "assistant";
    content: string;               // the message body as plain text
    createdAt: Date;
};

/** Input contract of the send-reply function in lib/email.ts. */
export type AssistantReplyEmailParams = {
    to: string;                    // the original sender — our recipient
    subject: string;               // "Re: <their subject>"
    textBody: string;              // the LLM-generated reply
    // The original email's Message-ID header. It is echoed in In-Reply-To /
    // References so mail clients thread the reply under their message.
    messageId: string;
};