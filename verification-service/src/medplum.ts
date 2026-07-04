/**
 * Medplum FHIR integration for the Verification Service.
 *
 * Responsibilities:
 *   - Service-level authentication (client_credentials)
 *   - Clinician token validation via /auth/me
 *   - Organization lookups and verification-tag checks
 *   - Verification token CRUD (FHIR Basic resources)
 *
 * Design decisions:
 *   - Errors are logged and propagated, never silently swallowed.
 *   - Extension URLs are constants to prevent typos.
 *   - FHIR references are parsed with validation.
 */

import { MedplumClient } from "@medplum/core";
import type { Bundle } from "@medplum/fhirtypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || "http://medplum-server:8103/";
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID || "";
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET || "";

/** FHIR extension URLs used on verification-token Basic resources. */
export const EXT = {
    RESOURCE_TYPE: "urn:hca:resource-type",
    VERIFICATION_STATUS: "urn:hca:verification-status",
    CLINIC_ID: "urn:hca:clinic-id",
    CLINIC_PSEUDONYM: "urn:hca:clinic-pseudonym",
    DIAGNOSIS: "urn:hca:diagnosis",
} as const;

/** Meta tag marking an Organization as verification-enabled. */
export const VERIFICATION_TAG = {
    system: "urn:hca:verification",
    code: "enabled",
} as const;

// ---------------------------------------------------------------------------
// Service client (singleton, client_credentials auth)
// ---------------------------------------------------------------------------

let serviceClient: MedplumClient | null = null;

export async function getServiceClient(): Promise<MedplumClient> {
    if (serviceClient) return serviceClient;

    serviceClient = new MedplumClient({
        baseUrl: MEDPLUM_BASE_URL,
        fetch: globalThis.fetch,
    });

    if (MEDPLUM_CLIENT_ID && MEDPLUM_CLIENT_SECRET) {
        await serviceClient.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);
    } else {
        console.warn("[medplum] No MEDPLUM_CLIENT_ID/SECRET configured — service client is unauthenticated");
    }

    return serviceClient;
}

// ---------------------------------------------------------------------------
// Clinician token validation
// ---------------------------------------------------------------------------

export interface ClinicianIdentity {
    practitionerId: string;
    profileRef: string;          // "Practitioner/<id>"
    organizationId: string | null;
    clinicRole: string | null;
    canVerify: boolean;
    isHcaAdmin: boolean;
}

/**
 * Validate a Medplum access token by calling /auth/me on the Medplum server.
 * Returns the clinician's identity including their organization (if any).
 *
 * The /auth/me endpoint returns { profile: { reference: "Practitioner/<id>" } }
 * for valid tokens. We then look up the Practitioner's Organization via
 * PractitionerRole using the service client.
 */
export async function validateClinicianToken(accessToken: string): Promise<ClinicianIdentity | null> {
    // Step 1: Validate token via /auth/me
    let profileRef: string;
    let authMeData: any;
    try {
        const res = await fetch(`${MEDPLUM_BASE_URL}auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            console.info(`[medplum] Token validation failed: HTTP ${res.status}`);
            return null;
        }
        authMeData = await res.json();

        // /auth/me returns { profile: { reference: "Practitioner/xxx" } }
        // or { profile: { resourceType: "Practitioner", id: "xxx", ... } }
        const profile = authMeData?.profile;
        if (profile?.reference) {
            profileRef = profile.reference;
        } else if (profile?.resourceType === "Practitioner" && profile?.id) {
            profileRef = `Practitioner/${profile.id}`;
        } else {
            console.info("[medplum] Token valid but profile is not a Practitioner");
            return null;
        }
    } catch (err) {
        console.error("[medplum] Failed to call /auth/me:", err);
        return null;
    }

    // Step 2: Parse reference
    const practitionerId = parseReference(profileRef, "Practitioner");
    if (!practitionerId) {
        console.warn(`[medplum] Unexpected profile reference format: ${profileRef}`);
        return null;
    }

    // Step 3: Resolve role/org access from PractitionerRole.
    // Fail closed on lookup errors so a Medplum issue never grants implicit admin access.
    let access: PractitionerRoleAccess;
    try {
        access = await getPractitionerRoleAccess(practitionerId);
    } catch (err) {
        console.error(`[medplum] Failed to resolve PractitionerRole for ${practitionerId}:`, err);
        return null;
    }

    // Step 4: Determine HCA-admin via explicit Medplum flags from /auth/me.
    const isHcaAdmin = extractIsHcaAdmin(authMeData);

    // No PractitionerRole and no explicit admin marker => deny.
    if (!access.hasRole && !isHcaAdmin) {
        console.warn(`[medplum] Practitioner/${practitionerId} has no role and no explicit admin flag`);
        return null;
    }

    return {
        practitionerId,
        profileRef,
        organizationId: access.organizationId,
        clinicRole: access.clinicRole,
        canVerify: access.canVerify,
        isHcaAdmin,
    };
}

// ---------------------------------------------------------------------------
// Organization helpers
// ---------------------------------------------------------------------------

/**
 * Find a Practitioner's Organization through their PractitionerRole.
 * Returns the Organization FHIR ID or null if no role exists.
 */
type PractitionerRoleAccess = {
    organizationId: string | null;
    clinicRole: string | null;
    canVerify: boolean;
    hasRole: boolean;
};

async function getPractitionerRoleAccess(practitionerId: string): Promise<PractitionerRoleAccess> {
    const client = await getServiceClient();
    const bundle: Bundle = await client.search("PractitionerRole", {
        practitioner: `Practitioner/${practitionerId}`,
        _count: "1",
    });
    const role = bundle.entry?.[0]?.resource as any;
    if (!role) {
        return {
            organizationId: null,
            clinicRole: null,
            canVerify: false,
            hasRole: false,
        };
    }

    const organizationId = parseReference(role.organization?.reference ?? "", "Organization");
    const extensions = Array.isArray(role.extension) ? role.extension : [];
    const clinicRoleExt = extensions.find((e: any) => e?.url === "urn:hca:clinic-role");
    const canVerifyExt = extensions.find((e: any) => e?.url === "urn:hca:can-verify");
    const clinicRole = typeof clinicRoleExt?.valueString === "string" ? clinicRoleExt.valueString : null;
    const canVerify =
        canVerifyExt?.valueBoolean === true ||
        canVerifyExt?.valueString === "true" ||
        clinicRole === "admin";

    return {
        organizationId,
        clinicRole,
        canVerify,
        hasRole: true,
    };
}

function extractIsHcaAdmin(authMeData: any): boolean {
    if (!authMeData || typeof authMeData !== "object") return false;

    if (authMeData?.isAdmin === true) return true;
    if (authMeData?.projectMembership?.admin === true) return true;
    if (authMeData?.membership?.admin === true) return true;

    const arrays = [
        authMeData?.projectMemberships,
        authMeData?.memberships,
        authMeData?.projects,
    ];
    for (const entries of arrays) {
        if (!Array.isArray(entries)) continue;
        if (entries.some((entry) => entry?.admin === true)) return true;
    }

    return false;
}

/**
 * Check if an Organization has the verification-enabled tag.
 */
export async function isVerificationEnabled(organizationId: string): Promise<boolean> {
    const client = await getServiceClient();
    try {
        const org = await client.readResource("Organization", organizationId);
        const tags = org.meta?.tag ?? [];
        return tags.some(
            (t) => t.system === VERIFICATION_TAG.system && t.code === VERIFICATION_TAG.code
        );
    } catch (err) {
        console.error(`[medplum] Failed to read Organization ${organizationId}:`, err);
        return false;
    }
}

/**
 * Get Organization display name.
 */
export async function getOrganizationName(organizationId: string): Promise<string> {
    const client = await getServiceClient();
    try {
        const org = await client.readResource("Organization", organizationId);
        return org.name ?? "Unknown Clinic";
    } catch (err) {
        console.error(`[medplum] Failed to read Organization name for ${organizationId}:`, err);
        return "Unknown Clinic";
    }
}

// ---------------------------------------------------------------------------
// Verification token CRUD (FHIR Basic resources in Medplum)
// ---------------------------------------------------------------------------

export interface CreateTokenParams {
    tokenId: string;
    clinicId: string;
    clinicPseudonym: string;
    diagnosis: { system: string; code: string; display?: string };
}

/**
 * Create a verification token as a FHIR Basic resource in Medplum.
 * Throws on failure — caller must handle the error.
 */
export async function createVerificationToken(params: CreateTokenParams): Promise<void> {
    const client = await getServiceClient();

    await client.createResource({
        resourceType: "Basic",
        code: {
            coding: [{ system: EXT.RESOURCE_TYPE, code: "verification-token" }],
        },
        identifier: [
            { system: "urn:hca:verification-token", value: params.tokenId },
        ],
        extension: [
            { url: EXT.VERIFICATION_STATUS, valueCode: "valid" },
            { url: EXT.CLINIC_ID, valueString: params.clinicId },
            { url: EXT.CLINIC_PSEUDONYM, valueString: params.clinicPseudonym },
            {
                url: EXT.DIAGNOSIS,
                valueCoding: {
                    system: params.diagnosis.system,
                    code: params.diagnosis.code,
                    ...(params.diagnosis.display ? { display: params.diagnosis.display } : {}),
                },
            },
        ],
    } as Parameters<typeof client.createResource>[0]);
}

export interface TokenStatus {
    status: "valid" | "revoked";
    clinicId: string;
    clinicPseudonym: string;
    issuedAt: string;
}

/**
 * Get the status of a verification token.
 * Returns null if the token does not exist.
 * Throws on Medplum errors.
 */
export async function getVerificationTokenStatus(tokenId: string): Promise<TokenStatus | null> {
    const resource = await findTokenResource(tokenId);
    if (!resource) return null;
    return extractTokenFields(resource);
}

/**
 * Revoke a verification token. Returns the clinic ID of the revoked token
 * so the caller can verify ownership. Throws on failure.
 */
export async function revokeVerificationToken(tokenId: string): Promise<{ clinicId: string }> {
    const client = await getServiceClient() as any;
    const resource = await findTokenResource(tokenId);
    if (!resource) {
        throw new Error(`Token ${tokenId} not found in Medplum`);
    }

    const fields = extractTokenFields(resource);

    // Update the status extension to "revoked"
    const extensions = ((resource as any).extension ?? []).map((e: { url: string; [k: string]: unknown }) => {
        if (e.url === EXT.VERIFICATION_STATUS) {
            return { ...e, valueCode: "revoked" };
        }
        return e;
    });

    await client.updateResource({ ...resource, extension: extensions } as any);

    return { clinicId: fields.clinicId };
}

/**
 * Get all verification tokens, optionally filtered by clinic.
 * If clinicId is null, returns all tokens (admin mode).
 */
export async function getClinicTokens(clinicId: string | null): Promise<TokenStatus[]> {
    const client = await getServiceClient();

    const bundle: Bundle = await client.search("Basic", {
        code: `${EXT.RESOURCE_TYPE}|verification-token`,
        _count: "200",
    });

    const results: TokenStatus[] = [];
    for (const entry of bundle.entry ?? []) {
        const resource = entry.resource as any;
        if (!resource) continue;

        try {
            const fields = extractTokenFields(resource);
            if (clinicId && fields.clinicId !== clinicId) continue;
            results.push(fields);
        } catch {
            console.warn(`[medplum] Skipping malformed verification-token resource: ${resource.id}`);
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a FHIR reference string like "Organization/abc-123" into the ID part.
 * Returns null if the reference doesn't match the expected resourceType.
 */
function parseReference(ref: string, expectedType: string): string | null {
    const parts = ref.split("/");
    if (parts.length !== 2) return null;
    if (parts[0] !== expectedType) return null;
    if (!parts[1]) return null;
    return parts[1];
}

/** Find a verification-token Basic resource by its identifier. */
async function findTokenResource(tokenId: string): Promise<any | null> {
    const client = await getServiceClient();
    const bundle: Bundle = await client.search("Basic", {
        code: `${EXT.RESOURCE_TYPE}|verification-token`,
        identifier: `urn:hca:verification-token|${tokenId}`,
        _count: "1",
    });

    return (bundle.entry ?? [])[0]?.resource ?? null;
}

// ---------------------------------------------------------------------------
// Admin: Verification toggle
// ---------------------------------------------------------------------------

/**
 * Enable or disable verification for an organization by adding/removing the tag.
 */
export async function setVerificationEnabled(organizationId: string, enabled: boolean): Promise<void> {
    const client = await getServiceClient();
    const org = await client.readResource("Organization", organizationId) as any;
    const tags = (org.meta?.tag ?? []) as Array<{ system: string; code: string }>;

    if (enabled) {
        const alreadyHas = tags.some(
            (t) => t.system === VERIFICATION_TAG.system && t.code === VERIFICATION_TAG.code
        );
        if (!alreadyHas) {
            tags.push({ system: VERIFICATION_TAG.system, code: VERIFICATION_TAG.code });
        }
    } else {
        const filtered = tags.filter(
            (t) => !(t.system === VERIFICATION_TAG.system && t.code === VERIFICATION_TAG.code)
        );
        tags.length = 0;
        tags.push(...filtered);
    }

    org.meta = { ...org.meta, tag: tags };
    await (client as any).updateResource(org);
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

const MEDPLUM_PROJECT_ID = process.env.MEDPLUM_PROJECT_ID || "";

/**
 * Resolve the Medplum project ID from env or from a FHIR resource's meta.project.
 */
async function resolveProjectId(client: MedplumClient, resourceType: string, resourceId: string): Promise<string> {
    if (MEDPLUM_PROJECT_ID) return MEDPLUM_PROJECT_ID;

    // Medplum stores the project ID in meta.project on every FHIR resource
    const resource = await client.readResource(resourceType as any, resourceId);
    const projectId = (resource.meta as any)?.project;
    if (!projectId) throw new Error(`Cannot determine project ID from ${resourceType}/${resourceId}`);
    return projectId;
}

export interface ClinicUserInfo {
    practitionerId: string;
    practitionerRoleId: string;
    firstName: string;
    lastName: string;
    email: string;
    clinicRole: string | null;
    canVerify: boolean;
}

/**
 * Get all users for a clinic via PractitionerRole search.
 */
export async function getClinicUsers(clinicId: string): Promise<ClinicUserInfo[]> {
    const client = await getServiceClient();

    const bundle: Bundle = await client.search("PractitionerRole", {
        organization: `Organization/${clinicId}`,
        _include: "PractitionerRole:practitioner",
        _count: "200",
    });

    const practitioners = new Map<string, any>();
    const roles: any[] = [];

    for (const entry of bundle.entry ?? []) {
        const resource = entry.resource as any;
        if (!resource) continue;
        if (resource.resourceType === "Practitioner") {
            practitioners.set(resource.id, resource);
        } else if (resource.resourceType === "PractitionerRole") {
            roles.push(resource);
        }
    }

    return roles.map((role) => {
        const practitionerId = parseReference(role.practitioner?.reference ?? "", "Practitioner") ?? "";
        const practitioner = practitioners.get(practitionerId);
        const extensions = (role.extension ?? []) as Array<{ url: string; [k: string]: unknown }>;

        const clinicRoleExt = extensions.find((e: any) => e.url === "urn:hca:clinic-role");
        const canVerifyExt = extensions.find((e: any) => e.url === "urn:hca:can-verify");

        const name = practitioner?.name?.[0];
        const email = practitioner?.telecom?.find((t: any) => t.system === "email")?.value ?? "";

        return {
            practitionerId,
            practitionerRoleId: role.id,
            firstName: name?.given?.[0] ?? "",
            lastName: name?.family ?? "",
            email,
            clinicRole: (clinicRoleExt?.valueString as string) ?? null,
            canVerify: canVerifyExt?.valueBoolean === true || canVerifyExt?.valueString === "true",
        };
    });
}

/**
 * Update user permissions on a PractitionerRole.
 */
export async function updateUserPermissions(
    practitionerRoleId: string,
    permissions: { canVerify?: boolean; clinicRole?: string },
): Promise<void> {
    const client = await getServiceClient();
    const role = await client.readResource("PractitionerRole", practitionerRoleId) as any;

    let extensions = (role.extension ?? []) as Array<{ url: string; [k: string]: unknown }>;

    if (permissions.canVerify !== undefined) {
        extensions = extensions.filter((e: any) => e.url !== "urn:hca:can-verify");
        if (permissions.canVerify) {
            extensions.push({ url: "urn:hca:can-verify", valueBoolean: true });
        }
    }

    if (permissions.clinicRole !== undefined) {
        extensions = extensions.filter((e: any) => e.url !== "urn:hca:clinic-role");
        if (permissions.clinicRole) {
            extensions.push({ url: "urn:hca:clinic-role", valueString: permissions.clinicRole });
        }
    }

    role.extension = extensions;
    await (client as any).updateResource(role);
}

/**
 * Create a clinic user via Medplum Admin Invite API.
 * Creates User + Practitioner + ProjectMembership with password,
 * then adds a PractitionerRole linking to the clinic Organization.
 */
export async function createClinicUser(params: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    clinicId: string;
    role: string;
}): Promise<void> {
    const client = await getServiceClient();
    const projectId = await resolveProjectId(client, "Organization", params.clinicId);

    // Step 1: Invite user via Medplum admin API.
    // Creates User + Practitioner + ProjectMembership with password in one step.
    // Requires the service client's ProjectMembership to have admin: true.
    const accessToken = client.getAccessToken();
    const inviteRes = await fetch(`${MEDPLUM_BASE_URL}admin/projects/${projectId}/invite`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            resourceType: "Practitioner",
            firstName: params.firstName,
            lastName: params.lastName,
            email: params.email,
            password: params.password,
            sendEmail: false,
        }),
    });

    if (!inviteRes.ok) {
        const body = await inviteRes.text();
        let errorMessage = `Registration failed (${inviteRes.status})`;
        try {
            const outcome = JSON.parse(body);
            const detail = outcome?.issue?.[0]?.details?.text;
            if (detail) errorMessage = detail;
        } catch {
            // keep generic message
        }
        throw new Error(errorMessage);
    }

    const inviteData = await inviteRes.json() as any;
    let practitionerId: string | undefined;

    // Extract practitioner ID from invite response
    const profileRef = inviteData?.profile?.reference;
    if (profileRef) {
        practitionerId = parseReference(profileRef, "Practitioner") ?? undefined;
    }

    // Fallback: search by email
    if (!practitionerId) {
        const bundle: Bundle = await client.search("Practitioner", {
            telecom: `email|${params.email}`,
            _sort: "-_lastUpdated",
            _count: "1",
        });
        const resource = bundle.entry?.[0]?.resource as any;
        if (resource?.id) practitionerId = resource.id;
    }

    if (!practitionerId) {
        throw new Error("Could not determine practitioner after invitation");
    }

    // Step 2: Create PractitionerRole linking practitioner to organization
    await createPractitionerRole(client, practitionerId, params.clinicId, params.role);
}

/**
 * Delete a clinic user by removing their PractitionerRole.
 * Returns the clinicId for ownership verification.
 */
export async function getClinicIdForRole(practitionerRoleId: string): Promise<string> {
    const client = await getServiceClient();
    const role = await client.readResource("PractitionerRole", practitionerRoleId) as any;
    return parseReference(role.organization?.reference ?? "", "Organization") ?? "";
}

export async function deleteClinicUser(practitionerRoleId: string): Promise<void> {
    const client = await getServiceClient();
    await client.deleteResource("PractitionerRole", practitionerRoleId);
}

/**
 * Update a Practitioner's name.
 */
export async function updatePractitionerName(
    practitionerId: string,
    firstName: string,
    lastName: string,
): Promise<void> {
    const client = await getServiceClient();
    const practitioner = await client.readResource("Practitioner", practitionerId) as any;
    practitioner.name = [{ given: [firstName], family: lastName }];
    await (client as any).updateResource(practitioner);
}

/** Create a PractitionerRole linking a Practitioner to an Organization with role extensions. */
async function createPractitionerRole(
    client: MedplumClient,
    practitionerId: string,
    clinicId: string,
    role: string,
): Promise<void> {
    const extensions: Array<{ url: string; [k: string]: unknown }> = [];
    if (role === "admin") {
        extensions.push({ url: "urn:hca:clinic-role", valueString: "admin" });
    }
    if (role === "verifier" || role === "admin") {
        extensions.push({ url: "urn:hca:can-verify", valueBoolean: true });
    }

    await client.createResource({
        resourceType: "PractitionerRole",
        practitioner: { reference: `Practitioner/${practitionerId}` },
        organization: { reference: `Organization/${clinicId}` },
        active: true,
        ...(extensions.length > 0 ? { extension: extensions } : {}),
    } as any);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract typed fields from a verification-token Basic resource. */
function extractTokenFields(resource: any): TokenStatus & { tokenId: string } {
    const extensions = (resource.extension ?? []) as Array<{ url: string; [k: string]: unknown }>;
    const identifiers = (resource.identifier ?? []) as Array<{ value?: string }>;
    const meta = resource.meta as { lastUpdated?: string } | undefined;

    function getExt(url: string): Record<string, unknown> | undefined {
        return extensions.find((e) => e.url === url);
    }

    const statusExt = getExt(EXT.VERIFICATION_STATUS);
    const clinicIdExt = getExt(EXT.CLINIC_ID);
    const pseudonymExt = getExt(EXT.CLINIC_PSEUDONYM);

    return {
        tokenId: identifiers[0]?.value ?? (resource.id as string) ?? "unknown",
        status: statusExt?.valueCode === "revoked" ? "revoked" : "valid",
        clinicId: (clinicIdExt?.valueString as string) ?? "",
        clinicPseudonym: (pseudonymExt?.valueString as string) ?? "",
        issuedAt: meta?.lastUpdated ?? "",
    };
}
