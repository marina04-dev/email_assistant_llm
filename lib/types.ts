/** One row of the `contacts` table: a person who has emailed the bot. */
export type ContactRow = {
    id: number;                    
    email: string;                
    displayName: string | null;
    firstSeenAt: Date;             
    lastSeenAt: Date;              
};

/** One row of the `messages` table: a single logged message. */
export type MessageLogRow = {
    id: number;
    threadId: string;
    role: "user" | "assistant";
    content: string;               
    createdAt: Date;
};

/** Input contract of the send-reply function in lib/email.ts. */
export type AssistantReplyEmailParams = {
    to: string;                    
    subject: string;               
    textBody: string;              
    messageId: string;
};