import { z } from "zod";

export const RequestVerificationSchema = z.object({
    clinic_id: z.string().min(1).max(255),
    device_id: z.string().min(1).max(255),
});

export const ConfirmVerificationSchema = z.object({
    diagnosis: z.object({
        system: z.string().min(1),
        code: z.string().min(1).max(20),
        display: z.string().optional(),
    }),
});

export const DiagnosisCoding = z.object({
    system: z.string(),
    code: z.string(),
    display: z.string().optional(),
});

export const CreateInvitationSchema = z.object({
    clinic_id: z.string().min(1),
    email: z.string().email().optional(),
    role: z.enum(["admin", "verifier", "member"]).default("admin"),
});

export const RedeemInvitationSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
});

export const ToggleVerificationSchema = z.object({
    enabled: z.boolean(),
});

export const UpdatePermissionsSchema = z.object({
    canVerify: z.boolean().optional(),
    clinicRole: z.string().optional(),
});

export const UpdateUserNameSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
});

export type RequestVerificationBody = z.infer<typeof RequestVerificationSchema>;
export type ConfirmVerificationBody = z.infer<typeof ConfirmVerificationSchema>;

// ─── Saved grid views (portal) ─────────────────────────────────────

export const SAVED_VIEW_SCOPES = [
    "clinics",
    "clinic-studies",
    "content",
    "practitioners",
    "studies",
    "suppliers",
    "users",
    "tokens",
    "verifications",
] as const;

export const CreateSavedViewSchema = z.object({
    scope: z.enum(SAVED_VIEW_SCOPES),
    name: z.string().min(1).max(80),
    search_params: z.string().max(4000).default(""),
    pinned: z.boolean().default(false),
    is_default: z.boolean().default(false),
});

export const UpdateSavedViewSchema = z.object({
    name: z.string().min(1).max(80).optional(),
    search_params: z.string().max(4000).optional(),
    pinned: z.boolean().optional(),
    is_default: z.boolean().optional(),
});

// ─── Portal mail settings (Settings -> Mail-Server) ────────────────

export const SmtpSettingsSchema = z.object({
    host: z.string().max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    username: z.string().max(255).optional(),
    password: z.string().max(255).optional(),
    clear_password: z.boolean().optional(),
    from_email: z.string().email().max(255).optional().or(z.literal("")),
    from_name: z.string().max(255).optional(),
    reply_to: z.string().email().max(255).optional().or(z.literal("")),
    portal_base_url: z.string().max(500).optional(),
});

export const MailTemplateSchema = z.object({
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
});

export const MailTemplatesPatchSchema = z.object({
    invitation: MailTemplateSchema.optional(),
});

export const TestMailSchema = z.object({
    to: z.string().email(),
});
