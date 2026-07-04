import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEYS_JSON = process.env.SUPPLIER_PAYLOAD_KEYS_JSON;
const ACTIVE_KEY_VERSION_RAW = process.env.SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION;

type Keyring = {
    activeVersion: number;
    keys: Map<number, Buffer>;
};

export type EncryptedPayloadEnvelope = {
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
    keyVersion: number;
};

function fail(msg: string): never {
    throw new Error(`supplier-crypto: ${msg}`);
}

function parseKeyVersion(raw: string | undefined, fieldName: string): number {
    if (!raw) fail(`${fieldName} is required`);
    const version = Number(raw);
    if (!Number.isInteger(version) || version <= 0) {
        fail(`${fieldName} must be a positive integer`);
    }
    return version;
}

function decodeKey(base64Value: string, version: number): Buffer {
    let key: Buffer;
    try {
        key = Buffer.from(base64Value, "base64");
    } catch {
        fail(`invalid base64 key for version ${version}`);
    }

    if (key.length !== 32) {
        fail(`key version ${version} must decode to 32 bytes (AES-256 key)`);
    }
    return key;
}

function loadKeyring(): Keyring {
    if (!KEYS_JSON) fail("SUPPLIER_PAYLOAD_KEYS_JSON is required");

    let parsed: unknown;
    try {
        parsed = JSON.parse(KEYS_JSON);
    } catch {
        fail("SUPPLIER_PAYLOAD_KEYS_JSON must be valid JSON object");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("SUPPLIER_PAYLOAD_KEYS_JSON must be an object like {\"1\":\"<base64-key>\"}");
    }

    const keys = new Map<number, Buffer>();
    for (const [rawVersion, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        const version = parseKeyVersion(rawVersion, "SUPPLIER_PAYLOAD_KEYS_JSON key version");
        if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
            fail(`key version ${version} must be a non-empty base64 string`);
        }
        keys.set(version, decodeKey(rawValue, version));
    }

    if (keys.size === 0) {
        fail("SUPPLIER_PAYLOAD_KEYS_JSON must contain at least one key");
    }

    const activeVersion = parseKeyVersion(ACTIVE_KEY_VERSION_RAW, "SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION");
    if (!keys.has(activeVersion)) {
        fail(`active key version ${activeVersion} is not present in SUPPLIER_PAYLOAD_KEYS_JSON`);
    }

    return { activeVersion, keys };
}

const keyring = loadKeyring();

function getKey(version: number): Buffer {
    const key = keyring.keys.get(version);
    if (!key) {
        fail(`missing decryption key version ${version}`);
    }
    return key;
}

function encryptBytes(plaintext: Buffer, aadContext: string): EncryptedPayloadEnvelope {
    const keyVersion = keyring.activeVersion;
    const key = getKey(keyVersion);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aadContext, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        ciphertext,
        iv,
        authTag,
        keyVersion,
    };
}

function decryptBytes(envelope: EncryptedPayloadEnvelope, aadContext: string): Buffer {
    const key = getKey(envelope.keyVersion);
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.iv);
    decipher.setAAD(Buffer.from(aadContext, "utf8"));
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
}

export function encryptJson(value: unknown, aadContext: string): EncryptedPayloadEnvelope {
    return encryptBytes(Buffer.from(JSON.stringify(value), "utf8"), aadContext);
}

export function decryptJson<T>(envelope: EncryptedPayloadEnvelope, aadContext: string): T {
    const plain = decryptBytes(envelope, aadContext).toString("utf8");
    return JSON.parse(plain) as T;
}

export function encryptSecret(plainText: string): EncryptedPayloadEnvelope {
    return encryptBytes(Buffer.from(plainText, "utf8"), "supplier-secret/v1");
}

export function decryptSecret(envelope: EncryptedPayloadEnvelope): string {
    return decryptBytes(envelope, "supplier-secret/v1").toString("utf8");
}

export function encryptPushPayload(bundle: unknown): EncryptedPayloadEnvelope {
    return encryptJson(bundle, "supplier-push-payload/v1");
}

export function decryptPushPayload<T>(envelope: EncryptedPayloadEnvelope): T {
    return decryptJson<T>(envelope, "supplier-push-payload/v1");
}

export function encryptProposalPayload(proposal: unknown): EncryptedPayloadEnvelope {
    return encryptJson(proposal, "supplier-proposal-payload/v1");
}

export function decryptProposalPayload<T>(envelope: EncryptedPayloadEnvelope): T {
    return decryptJson<T>(envelope, "supplier-proposal-payload/v1");
}

export function sha256Hex(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("hex");
}
