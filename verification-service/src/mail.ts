/**
 * Outgoing mail — SMTP via nodemailer (moonshot pattern, ported to
 * the clinic portal's Fastify service).
 *
 * Settings live in the `portal_settings` singleton (id=1) and are
 * managed in the portal under Settings -> Mail-Server. Templates are
 * HTML with `{placeholder}` variables. When no SMTP host is
 * configured, sendMail() throws `mail_not_configured` — callers
 * decide whether that is fatal (test mail) or a silent no-op
 * (invitation falls back to the copyable link).
 */

import nodemailer from "nodemailer";
import { pool } from "./db";

export type SmtpSettings = {
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string;
    password?: string;
    from_email?: string;
    from_name?: string;
    reply_to?: string;
    /** Portal base URL for links in mails, e.g. "https://clinic.tenos.app". */
    portal_base_url?: string;
};

export type MailTemplate = {
    subject: string;
    body: string;
};

export type MailTemplates = {
    /** Portal invitation ({clinic}, {role}, {invite_link}, {expires_at}) */
    invitation: MailTemplate;
};

const MAIL_FOOTER = [
    "<p>Viele Grüße<br>help cure ALS e.V.</p>",
    "<p>—<br>help cure ALS e.V.<br>Wredestrasse 21<br>90431 Nürnberg<br>Germany</p>",
    '<p><a href="http://www.help-cure-als.org">www.help-cure-als.org</a><br>'
    + '<a href="https://tenos.app/">www.tenos.app</a></p>',
].join("");

export const DEFAULT_MAIL_TEMPLATES: MailTemplates = {
    invitation: {
        subject: "Einladung zum TENOS Clinic Portal — {clinic}",
        body: [
            "<p>Guten Tag,</p>",
            "<p>Sie wurden eingeladen, dem TENOS Clinic Portal der Einrichtung "
            + "<strong>{clinic}</strong> beizutreten (Rolle: {role}).</p>",
            "<p>Über den folgenden Link können Sie Ihr Konto anlegen. "
            + "Der Link ist gültig bis {expires_at}:</p>",
            '<p><a href="{invite_link}">{invite_link}</a></p>',
            "<p>Falls Sie diese Einladung nicht erwartet haben, können Sie "
            + "diese E-Mail ignorieren.</p>",
            MAIL_FOOTER,
        ].join(""),
    },
};

export type PortalMailSettings = {
    smtp: SmtpSettings;
    templates: MailTemplates;
};

export async function getPortalMailSettings(): Promise<PortalMailSettings> {
    const result = await pool.query<{
        smtp: SmtpSettings | null;
        mail_templates: Partial<MailTemplates> | null;
    }>(`SELECT smtp, mail_templates FROM portal_settings WHERE id = 1 LIMIT 1`);

    const row = result.rows[0] ?? { smtp: null, mail_templates: null };
    const templates = (row.mail_templates ?? {}) as Partial<MailTemplates>;
    return {
        smtp: (row.smtp ?? {}) as SmtpSettings,
        templates: {
            invitation: templates.invitation ?? DEFAULT_MAIL_TEMPLATES.invitation,
        },
    };
}

export async function saveSmtpSettings(smtp: SmtpSettings): Promise<void> {
    await pool.query(
        `INSERT INTO portal_settings (id, smtp, updated_at)
         VALUES (1, $1::jsonb, now())
         ON CONFLICT (id) DO UPDATE
           SET smtp = EXCLUDED.smtp, updated_at = now()`,
        [JSON.stringify(smtp)],
    );
}

export async function saveMailTemplates(templates: MailTemplates): Promise<void> {
    await pool.query(
        `INSERT INTO portal_settings (id, mail_templates, updated_at)
         VALUES (1, $1::jsonb, now())
         ON CONFLICT (id) DO UPDATE
           SET mail_templates = EXCLUDED.mail_templates, updated_at = now()`,
        [JSON.stringify(templates)],
    );
}

export function isMailConfigured(smtp: SmtpSettings): boolean {
    return Boolean(smtp.host && smtp.from_email);
}

/** Replaces {placeholder} variables; unknown placeholders stay put. */
export function renderMailTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/** Plain-text fallback for HTML mail bodies. */
export function htmlToText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export async function sendMail(
    smtp: SmtpSettings,
    message: { to: string; subject: string; html: string },
): Promise<void> {
    if (!isMailConfigured(smtp)) {
        throw new Error("mail_not_configured");
    }

    const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port ?? 587,
        secure: smtp.secure ?? false,
        ...(smtp.username
            ? { auth: { user: smtp.username, pass: smtp.password ?? "" } }
            : {}),
    });

    await transporter.sendMail({
        from: smtp.from_name
            ? `"${smtp.from_name}" <${smtp.from_email}>`
            : smtp.from_email,
        ...(smtp.reply_to ? { replyTo: smtp.reply_to } : {}),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: htmlToText(message.html),
    });
}

/** Convenience: renders a template and sends it. */
export async function sendTemplatedMail(
    to: string,
    template: MailTemplate,
    vars: Record<string, string>,
): Promise<void> {
    const { smtp } = await getPortalMailSettings();
    await sendMail(smtp, {
        to,
        subject: renderMailTemplate(template.subject, vars),
        html: renderMailTemplate(template.body, vars),
    });
}
