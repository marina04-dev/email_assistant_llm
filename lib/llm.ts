/**
 * lib/llm.ts — the LLM layer: one function that turns an email body into a
 * reply, using Google's Gemini API (free key from https://aistudio.google.com).
 *
 * Everything Gemini-specific is contained here. If providers ever change,
 * only this file would change — same encapsulation principle as lib/db.ts.
 */

import {GoogleGenAI} from "@google/genai";                 // Google's official SDK (an npm package — not a path alias)
import {inboundAssistantSystemPrompt} from "./prompts/inbound-assistant"; // relative: prompts/ sits inside lib/

// ---------------------------------------------------------------------------
// Client — created once, reused for every call (the singleton pattern, same
// as the database connection). `let x = null` + a getter that fills it on
// first use is called LAZY initialization: the client is only built when
// actually needed, and the missing-key error surfaces at a meaningful moment.
// ---------------------------------------------------------------------------

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    if (!client) {
        // process.env is Node's window into environment variables — this is
        // where the value from the .env file arrives at runtime.
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not set");
        }
        client = new GoogleGenAI({apiKey});
    }
    return client;
}

// Model name is overridable via .env without touching code — good practice,
// since model names change faster than logic does.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

/**
 * Generate the assistant's reply to ONE inbound email.
 *
 * @param userMessage  the plain-text body the sender wrote
 * @returns            the reply text, trimmed
 * @throws             if the API fails or returns empty — the CALLER decides
 *                     the fallback (the listener sends a polite apology);
 *                     a low-level layer shouldn't invent user-facing text.
 */
export async function generateAssistantReply(userMessage: string): Promise<string> {
    const response = await getClient().models.generateContent({
        model: MODEL,

        // The sender's email body — the material to respond to.
        contents: userMessage,

        config: {
            // Standing rules from file 4 — kept separate from `contents`
            // so instructions and material never blur together.
            systemInstruction: inboundAssistantSystemPrompt,

            // Hard ceiling on reply length, in tokens (a token ≈ ¾ of a word).
            // Set generously: on models that spend hidden "thinking" tokens,
            // those count against this limit, and a tight budget can produce
            // an empty visible answer.
            maxOutputTokens: 2048,
        },
    });

    // `response.text` gathers the text parts of the answer; `?.` (optional
    // chaining) safely yields undefined instead of crashing if it's absent.
    const text = response.text?.trim();
    if (!text) {
        throw new Error("Gemini returned an empty response");
    }
    return text;
}