import {GoogleGenAI} from "@google/genai";                 
import {inboundAssistantSystemPrompt} from "./prompts/inbound-assistant";


let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    if (!client) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not set");
        }
        client = new GoogleGenAI({apiKey});
    }
    return client;
}

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

        contents: userMessage,

        config: {
            systemInstruction: inboundAssistantSystemPrompt,
            maxOutputTokens: 2048,
        },
    });

    const text = response.text?.trim();
    if (!text) {
        throw new Error("Gemini returned an empty response");
    }
    return text;
}