import type {MessageLogRow} from "../lib/types"; 


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
                                    {m.createdAt.toLocaleString()} · thread{" "}
                                    {m.threadId.slice(0, 18)}…
                                </span>
                            </div>
                            <p className="whitespace-pre-wrap text-gray-800">{m.content}</p>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}