import {getAllContacts, getRecentMessageLog} from "../lib/db";
import {ContactList} from "../components/ContactList";
import {EmailLog} from "../components/EmailLog";


export const dynamic = "force-dynamic";

export default async function Home() {
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