import type {MessageLogRow} from "../lib/types"; // relative: up one level, into lib/

/**
 * components/EmailLog.tsx — pure presentation: renders the message log,
 * newest first. An inbound email and its AI reply share a threadId (the
 * original Message-ID), shown truncated for reference.
 *
 * Server Component (no "use client"): display-only, no interactivity.
 */
export function EmailLog({log}: {log: MessageLogRow[]}) {
    return (
        <section>
            <h2 className="text-lg font-semibold mb-3">Email log</h2>

            {log.length === 0 ? (
                <p className="text-sm text-gray-500">
                    Nothing logged yet — messages appear here after the first reply.
                </p>
            ) : (
                <ul className="space-y-3">
                    {log.map((m) => (
                        <li
                            key={m.id}
                            // Template string inside className: the base classes
                            // plus a role-dependent color — AI replies get a
                            // blue tint, received mail stays white. A small
                            // visual encoding of the `role` union type.
                            className={`rounded-lg border p-4 text-sm ${
                                m.role === "assistant"
                                    ? "border-blue-200 bg-blue-50"
                                    : "border-gray-200 bg-white"
                            }`}
                        >
                            <div className="mb-1 flex items-center justify-between gap-4">
                                <span className="font-medium">
                                    {m.role === "assistant" ? "AI reply" : "Received"}
                                </span>
                                <span className="text-xs text-gray-500">
                                    {/* slice(0, 18) truncates the long Message-ID
                                        to keep the header row compact. */}
                                    {m.createdAt.toLocaleString()} · thread{" "}
                                    {m.threadId.slice(0, 18)}…
                                </span>
                            </div>
                            {/* whitespace-pre-wrap preserves the line breaks of
                                the original plain-text email body. */}
                            <p className="whitespace-pre-wrap text-gray-800">{m.content}</p>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}