import { z } from "zod";

const categoryEnum = z.enum([
    "mobility",
    "transfer",
    "communication",
    "respiratory",
    "nutrition",
    "daily_living",
]);

const roleEnum = z.enum(["patient", "caregiver", "doctor"]);
const aidStatusEnum = z.enum(["none", "suggested", "requested", "approved", "rejected"]);
const deliveryAuthModeEnum = z.enum(["hmac", "bearer"]);

export const SelectionPolicySchema = z.object({
    integrationId: z.string().optional(),
    metricIds: z.array(z.string()),
    categories: z.record(z.boolean()),
    directions: z.object({
        outbound: z.boolean(),
        inbound: z.boolean(),
    }),
});

export const LinkCareOrgSchema = z.object({
    organization_id: z.string().min(1),
    verification_token_id: z.string().uuid(),
    policy: SelectionPolicySchema,
});

export const AcceptPartnerRequestSchema = z.object({
    request_token: z.string().min(8),
    verification_token_id: z.string().uuid(),
    policy: SelectionPolicySchema,
});

export const PartnerLinkRequestCreateSchema = z.object({
    organization_id: z.string().min(1),
    expires_minutes: z.number().int().positive().max(60 * 24).optional(),
});

export const PushBundleSchema = z.object({
    bundle: z.unknown(),
});

export const InboundProposalSchema = z.object({
    proposal_id: z.string().min(1),
    catalog_id: z.string().optional(),
    name: z.string().min(1),
    category: categoryEnum,
    reason: z.string().optional(),
    created_at: z.string().datetime(),
});

export const ProposalSchema = InboundProposalSchema.extend({
    organization_id: z.string().min(1),
    organization_name: z.string().min(1),
});

export const UpsertProposalsSchema = z.object({
    proposals: z.array(InboundProposalSchema).min(1).max(500),
});

export const UpsertGlobalProposalsSchema = z.object({
    contract_id: z.string().uuid(),
    proposals: z.array(InboundProposalSchema).min(1).max(500),
});

export const DecisionSchema = z.object({
    decision: z.enum(["accepted", "declined"]),
});

export const WorkflowTransitionSchema = z.object({
    from: aidStatusEnum,
    to: aidStatusEnum,
    allowed_roles: z.array(roleEnum).min(1),
});

export const WorkflowPolicySchema = z.object({
    country: z.string().min(2).max(3),
    transitions: z.array(WorkflowTransitionSchema),
    notify_provider_on: z.array(aidStatusEnum),
});

export const WorkflowPolicyQuerySchema = z.object({
    country: z.string().min(2).max(3).optional(),
});

export const UpsertWorkflowPolicySchema = z.object({
    policy: WorkflowPolicySchema,
});

export const TransitionTicketSchema = z.object({
    integration_id: z.string().min(1).optional(),
    proposal_id: z.string().min(1).optional(),
    aid_id: z.string().min(1),
    from: aidStatusEnum,
    to: aidStatusEnum,
    role: roleEnum,
    device_id: z.string().min(1),
    timestamp: z.string().datetime(),
});

export const DeliveryConfigUpsertSchema = z.object({
    endpoint_url: z.string().url(),
    auth_mode: deliveryAuthModeEnum,
    auth_secret: z.string().min(8).optional(),
    enabled: z.boolean().optional(),
    timeout_ms: z.number().int().min(1000).max(120000).optional(),
});

export const DeliveryAttemptsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const DeliveryTestSchema = z.object({
    payload: z.unknown().optional(),
});

export const AdminCreateIntegrationSchema = z.object({
    policy: SelectionPolicySchema.optional(),
});
