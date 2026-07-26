import type {ContactRow} from "../lib/types"; // relative: up one level, into lib/

/**
 * components/ContactList.tsx — pure presentation: receives the contacts as a
 * prop and renders them as a table.
 *
 * No "use client" directive: with no interactivity and no browser-only APIs,
 * this stays a React Server Component (the App Router default) — it runs on
 * the server and ships finished HTML to the browser.
 */
export function ContactList({contacts}: {contacts: ContactRow[]}) {
    return (
        <section>
            <h2 className="text-lg font-semibold mb-3">Contacts</h2>

            {/* Conditional rendering: an explicit empty state is friendlier
                than a bare, headerless table. The ternary (cond ? A : B)
                picks which JSX branch to show. */}
            {contacts.length === 0 ? (
                <p className="text-sm text-gray-500">
                    No contacts yet — send the bot an email to create the first one.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left">
                            <tr>
                                <th className="px-4 py-2 font-medium">Email</th>
                                <th className="px-4 py-2 font-medium">Name</th>
                                <th className="px-4 py-2 font-medium">First seen</th>
                                <th className="px-4 py-2 font-medium">Last seen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* .map() turns each data row into a table row.
                                `key` gives React a stable identity per row so
                                list updates are matched correctly — the DB id
                                is the natural choice. */}
                            {contacts.map((c) => (
                                <tr key={c.id} className="border-t border-gray-100">
                                    <td className="px-4 py-2 font-mono">{c.email}</td>
                                    {/* `??` (nullish coalescing) shows a dash
                                        when displayName is null. */}
                                    <td className="px-4 py-2">{c.displayName ?? "—"}</td>
                                    <td className="px-4 py-2 text-gray-500">
                                        {c.firstSeenAt.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-gray-500">
                                        {c.lastSeenAt.toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}