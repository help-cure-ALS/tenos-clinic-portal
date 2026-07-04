type VerificationTokenResponse = {
    status: string;
    clinic_pseudonym?: string;
    issued_at?: string;
};

export type VerificationCheckResult = {
    valid: boolean;
    reason?: string;
    clinicPseudonym?: string;
    issuedAt?: string;
};

function baseUrlNoSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

/**
 * Verify a verification token against the external verification-service.
 *
 * This mirrors the existing research-proxy trust pattern: the supplier-proxy
 * does not own verification state, it only checks whether a supplied token is
 * currently valid.
 */
export async function verifyVerificationToken(
    tokenId: string | undefined,
    serviceUrl: string | undefined,
    serviceToken: string | undefined,
): Promise<VerificationCheckResult> {
    if (!tokenId) {
        return { valid: false, reason: "missing_verification_token" };
    }

    if (!serviceUrl || !serviceToken) {
        return { valid: false, reason: "verification_service_unconfigured" };
    }

    try {
        const res = await fetch(
            `${baseUrlNoSlash(serviceUrl)}/verify/tokens/${encodeURIComponent(tokenId)}/status`,
            {
                headers: { "X-Service-Token": serviceToken },
            },
        );

        if (!res.ok) {
            if (res.status === 404) {
                return { valid: false, reason: "token_not_found" };
            }
            return { valid: false, reason: `verification_service_http_${res.status}` };
        }

        const data = await res.json() as VerificationTokenResponse;
        if (data.status !== "valid") {
            return {
                valid: false,
                reason: `token_${data.status ?? "invalid"}`,
                clinicPseudonym: data.clinic_pseudonym,
                issuedAt: data.issued_at,
            };
        }

        return {
            valid: true,
            clinicPseudonym: data.clinic_pseudonym,
            issuedAt: data.issued_at,
        };
    } catch {
        return { valid: false, reason: "verification_service_unreachable" };
    }
}
