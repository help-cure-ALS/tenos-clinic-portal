import { MedplumClient } from "@medplum/core";
import type { Bundle, Organization } from "@medplum/fhirtypes";

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || "http://medplum-server:8103/";
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID || "";
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET || "";

export const SUPPLIER_TAG = {
    system: "urn:hca:supplier",
    code: "enabled",
} as const;

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
        console.warn("[supplier-medplum] No MEDPLUM_CLIENT_ID/SECRET configured — service client is unauthenticated");
    }

    return serviceClient;
}

export type SupplierDirectoryEntry = {
    id: string;
    name: string;
    country: string;
    specialty: string;
};

export interface ClinicianIdentity {
    practitionerId: string;
    profileRef: string;
    organizationId: string | null;
    clinicRole: string | null;
    canVerify: boolean;
    isHcaAdmin: boolean;
}

export type SupplierOrganizationState = {
    id: string;
    exists: boolean;
    active: boolean;
    enabled: boolean;
    country: string;
    name: string;
    specialty: string;
};

function hasSupplierTag(org: Organization): boolean {
    const tags = org.meta?.tag ?? [];
    return tags.some((t) => t.system === SUPPLIER_TAG.system && t.code === SUPPLIER_TAG.code);
}

function isOrganizationActive(org: Organization): boolean {
    return org.active !== false;
}

function orgToDirectoryEntry(org: Organization): SupplierDirectoryEntry {
    const specialty =
        org.type?.[0]?.coding?.[0]?.display ??
        org.type?.[0]?.coding?.[0]?.code ??
        "General";

    return {
        id: org.id ?? "",
        name: org.name ?? "Unknown Supplier",
        country: org.address?.[0]?.country ?? "",
        specialty,
    };
}

function orgToState(org: Organization): SupplierOrganizationState {
    const entry = orgToDirectoryEntry(org);
    return {
        ...entry,
        exists: true,
        active: isOrganizationActive(org),
        enabled: hasSupplierTag(org),
    };
}

function parseReference(ref: string, expectedType: string): string | null {
    const parts = ref.split("/");
    if (parts.length !== 2) return null;
    if (parts[0] !== expectedType) return null;
    if (!parts[1]) return null;
    return parts[1];
}

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

export async function validateClinicianToken(accessToken: string): Promise<ClinicianIdentity | null> {
    let profileRef: string;
    let authMeData: any;
    try {
        const res = await fetch(`${MEDPLUM_BASE_URL}auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return null;
        authMeData = await res.json();
        const profile = authMeData?.profile;
        if (profile?.reference) {
            profileRef = profile.reference as string;
        } else if (profile?.resourceType === "Practitioner" && profile?.id) {
            profileRef = `Practitioner/${profile.id as string}`;
        } else {
            return null;
        }
    } catch (err) {
        console.error("[supplier-medplum] Failed to call /auth/me:", err);
        return null;
    }

    const practitionerId = parseReference(profileRef, "Practitioner");
    if (!practitionerId) return null;

    let access: PractitionerRoleAccess;
    try {
        access = await getPractitionerRoleAccess(practitionerId);
    } catch (err) {
        console.error(`[supplier-medplum] Failed to resolve PractitionerRole for ${practitionerId}:`, err);
        return null;
    }

    const isHcaAdmin = extractIsHcaAdmin(authMeData);
    if (!access.hasRole && !isHcaAdmin) {
        console.warn(`[supplier-medplum] Practitioner/${practitionerId} has no role and no explicit admin flag`);
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

export async function listSupplierOrganizations(country?: string): Promise<SupplierDirectoryEntry[]> {
    const client = await getServiceClient();
    const params: Record<string, string> = {
        _count: "1000",
        _sort: "name",
        _tag: `${SUPPLIER_TAG.system}|${SUPPLIER_TAG.code}`,
        active: "true",
    };

    if (country) {
        params["address-country"] = country;
    }

    const organizations = await client.searchResources("Organization", params);

    return organizations
        .filter(hasSupplierTag)
        .filter(isOrganizationActive)
        .map(orgToDirectoryEntry)
        .filter((o) => o.id.length > 0);
}

export async function getSupplierOrganizationState(orgId: string): Promise<SupplierOrganizationState> {
    try {
        const client = await getServiceClient();
        const org = await client.readResource("Organization", orgId);
        return orgToState(org);
    } catch {
        return {
            id: orgId,
            exists: false,
            active: false,
            enabled: false,
            country: "",
            name: "",
            specialty: "",
        };
    }
}

export async function getSupplierOrganization(orgId: string): Promise<SupplierDirectoryEntry | null> {
    const state = await getSupplierOrganizationState(orgId);
    if (!state.exists || !state.enabled || !state.active) return null;
    return {
        id: state.id,
        name: state.name,
        country: state.country,
        specialty: state.specialty,
    };
}
