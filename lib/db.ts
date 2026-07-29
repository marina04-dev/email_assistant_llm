import Database from "better-sqlite3";                     
import {drizzle} from "drizzle-orm/better-sqlite3";          
import {sqliteTable, text, integer} from "drizzle-orm/sqlite-core"; 
import {asc, desc} from "drizzle-orm";                      
import type {ContactRow, MessageLogRow} from "./types";  


export const contacts = sqliteTable("contacts", {
    id: integer("id").primaryKey({autoIncrement: true}),

    email: text("email").notNull().unique(),

    displayName: text("display_name"),

    firstSeenAt: integer("first_seen_at", {mode: "timestamp"})
        .notNull()
        .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", {mode: "timestamp"})
        .notNull()
        .$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
    id: integer("id").primaryKey({autoIncrement: true}),

    threadId: text("thread_id").notNull(),

    role: text("role", {enum: ["user", "assistant"]}).notNull(),

    content: text("content").notNull(),

    createdAt: integer("created_at", {mode: "timestamp"})
        .notNull()
        .$defaultFn(() => new Date()),
});


const sqlite = new Database("emails.db");


sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, {schema: {contacts, messages}});


export async function saveMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string
): Promise<void> {
    await db.insert(messages).values({threadId, role, content});
}


export async function upsertContact(
    email: string,
    displayName: string | null
): Promise<void> {
    const now = new Date();
    await db
        .insert(contacts)
        .values({email, displayName, firstSeenAt: now, lastSeenAt: now})
        .onConflictDoUpdate({
            target: contacts.email,      
            set: {displayName, lastSeenAt: now}, 
        });
}

export async function getRecentMessageLog(limit = 200): Promise<MessageLogRow[]> {
    const rows = await db
        .select()
        .from(messages)
        .orderBy(desc(messages.createdAt))   
        .limit(limit);                       

    return rows.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        role: r.role,
        content: r.content,
        createdAt: new Date(r.createdAt),
    }));
}

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