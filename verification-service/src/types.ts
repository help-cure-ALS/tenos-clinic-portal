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
