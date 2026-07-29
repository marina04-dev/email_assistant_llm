import nodemailer, {type Transporter} from "nodemailer";
import type {AssistantReplyEmailParams} from "./types"; // relative: same folder


let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
    if (!transporter) {
        const user = process.env.GMAIL_ADDRESS;
        const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
        if (!user || !pass) {
            throw new Error("GMAIL_ADDRESS or GMAIL_APP_PASSWORD is not set");
        }
        transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",  
            port: 465,               
            secure: true,            
            auth: {user, pass},
        });
    }
    return transporter;
}


function fromField(): string {
    const address = process.env.GMAIL_ADDRESS;
    if (!address) throw new Error("GMAIL_ADDRESS is not set");
    const name = process.env.ASSISTANT_NAME?.trim() || "Email Assistant";
    return `"${name}" <${address}>`;
}


export async function sendAssistantReplyEmail(
    args: AssistantReplyEmailParams
): Promise<void> {
    await getTransporter().sendMail({
        from: fromField(),
        to: args.to,               
        subject: args.subject,     
        text: args.textBody,       
        inReplyTo: args.messageId,
        references: args.messageId,
    });
}