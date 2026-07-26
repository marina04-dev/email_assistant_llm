import {getAllContacts, getRecentMessageLog} from "../lib/db";
import {ContactList} from "../components/ContactList";
import {EmailLog} from "../components/EmailLog";

/**
 * app/page.tsx — the dashboard homepage.
 *
 * A React Server Component: it runs on the server for each request, so it
 * can read the SQLite database DIRECTLY (no API endpoint needed) and ship
 * finished HTML to the browser. The listener process writes to the same
 * emails.db file; WAL mode (set in lib/db.ts) lets the two processes share
 * it safely.
 */

// Next.js caches pages aggressively by default. force-dynamic disables that
// for this page: it re-renders on every request, so a browser refresh always
// shows the latest emails and contacts instead of a stale snapshot.
export const dynamic = "force-dynamic";

export default async function Home() {
    // Promise.all runs both queries concurrently instead of one after the
    // other — a small but idiomatic efficiency habit.
    const [contacts, log] = await Promise.all([
        getAllContacts(),
        getRecentMessageLog(100),
    ]);

    return (
        <main className="mx-auto max-w-4xl p-6 space-y-10">
            <header>
                <h1 className="text-2xl font-bold">LLM Email Assistant</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Auto-replies to inbound email with Gemini · {contacts.length}{" "}
                    contact{contacts.length === 1 ? "" : "s"} · {log.length} logged message
                    {log.length === 1 ? "" : "s"}
                </p>
            </header>

            <ContactList contacts={contacts} />
            <EmailLog log={log} />
        </main>
    );
}