/**
 * lib/db.ts — the data layer: schema + connection + helpers.
 *
 * Three responsibilities, top to bottom:
 *   1. SCHEMA: define two tables in TypeScript (drizzle-kit reads these
 *      definitions to create the real tables; the app reads them to build
 *      type-checked queries).
 *   2. CONNECTION: open the SQLite file and wrap it with Drizzle (the ORM).
 *   3. HELPERS: the only four operations the rest of the app ever needs —
 *      nothing outside this file writes SQL or touches tables directly.
 *      (Encapsulation: if there was ever a need to swap databases, only this file changes.)
 */

import Database from "better-sqlite3";                       // the SQLite driver
import {drizzle} from "drizzle-orm/better-sqlite3";          // ORM adapter for that driver
import {sqliteTable, text, integer} from "drizzle-orm/sqlite-core"; // schema builders
import {asc, desc} from "drizzle-orm";                       // ORDER BY helpers
import type {ContactRow, MessageLogRow} from "./types";  // shared shapes

// ---------------------------------------------------------------------------
// 1. SCHEMA
// Each sqliteTable() call maps a table name to its columns. For every column:
// first argument = the real column name in the database (snake_case, the SQL
// convention); the object key = the property name in TypeScript code
// (camelCase, the JS convention). Drizzle translates between the two.
// ---------------------------------------------------------------------------

export const contacts = sqliteTable("contacts", {
    // primaryKey = the row's unique identifier; autoIncrement = the database
    // assigns 1, 2, 3, … itself.
    id: integer("id").primaryKey({autoIncrement: true}),

    // notNull = the DB rejects rows missing this; unique = the DB rejects a
    // second row with the same email — this constraint is what makes our
    // "upsert" below possible.
    email: text("email").notNull().unique(),

    // Nullable on purpose (no .notNull()) — matches `string | null` in types.ts.
    displayName: text("display_name"),

    // SQLite has no native date type, so timestamps are stored as integers
    // (milliseconds since 1970). mode: "timestamp" tells Drizzle to convert
    // to/from JS Date objects automatically. $defaultFn runs on INSERT when
    // no value was provided — "default to now".
    firstSeenAt: integer("first_seen_at", {mode: "timestamp"})
        .notNull()
        .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", {mode: "timestamp"})
        .notNull()
        .$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
    id: integer("id").primaryKey({autoIncrement: true}),

    // Original email's Message-ID; an inbound email and its AI reply share it.
    threadId: text("thread_id").notNull(),

    // enum: the DB itself refuses any value other than these two — the
    // database-level twin of the literal-union type in types.ts.
    role: text("role", {enum: ["user", "assistant"]}).notNull(),

    content: text("content").notNull(),

    createdAt: integer("created_at", {mode: "timestamp"})
        .notNull()
        .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// 2. CONNECTION
// ---------------------------------------------------------------------------

// Opens (or creates, on first run) the database file in the project root.
const sqlite = new Database("emails.db");

// WAL = Write-Ahead Logging, a journaling mode where writes go to a side
// file first. Crucial for us: TWO processes share this database — the
// listener WRITES while the dashboard READS — and WAL lets them do so
// concurrently without locking each other out.
sqlite.pragma("journal_mode = WAL");

// Wrap the raw driver with Drizzle: from here on, queries are TypeScript
// method chains checked against the schema above, not raw SQL strings.
export const db = drizzle(sqlite, {schema: {contacts, messages}});

// ---------------------------------------------------------------------------
// 3. HELPERS
// ---------------------------------------------------------------------------

/** Insert one message row. Called twice per email: the inbound, then the reply. */
export async function saveMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string
): Promise<void> {
    await db.insert(messages).values({threadId, role, content});
}

/**
 * "Upsert" = INSERT, or UPDATE if the row already exists.
 * Mechanism: try to insert; if the UNIQUE constraint on `email` fires
 * (sender already known), onConflictDoUpdate switches to updating that row
 * instead — refreshing the name and lastSeenAt while firstSeenAt stays put.
 * One atomic operation, no check-then-write race condition.
 */
export async function upsertContact(
    email: string,
    displayName: string | null
): Promise<void> {
    const now = new Date();
    await db
        .insert(contacts)
        .values({email, displayName, firstSeenAt: now, lastSeenAt: now})
        .onConflictDoUpdate({
            target: contacts.email,          // the constraint to watch
            set: {displayName, lastSeenAt: now}, // what to update on conflict
        });
}

/** Newest messages first, capped — the dashboard's data source. */
export async function getRecentMessageLog(limit = 200): Promise<MessageLogRow[]> {
    const rows = await db
        .select()
        .from(messages)
        .orderBy(desc(messages.createdAt))   // desc = newest first
        .limit(limit);                       // never load unbounded data into a page

    // Re-wrap into shared shape (and force real Date objects).
    return rows.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        role: r.role,
        content: r.content,
        createdAt: new Date(r.createdAt),
    }));
}

/** All contacts, alphabetically — the dashboard's other data source. */
export async function getAllContacts(): Promise<ContactRow[]> {
    const rows = await db.select().from(contacts).orderBy(asc(contacts.email));

    return rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        firstSeenAt: new Date(r.firstSeenAt),
        lastSeenAt: new Date(r.lastSeenAt),
    }));
}