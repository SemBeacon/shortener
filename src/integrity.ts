import crypto from 'node:crypto';
import { AuthClient, GoogleAuth } from 'google-auth-library';
import { IntegrityConfig } from './models/Application.model.js';

/** Version prefix of the canonical payload, shared with the app. */
export const INTEGRITY_PAYLOAD_VERSION = 'sembeacon-shorten-v1';

/** Default maximum age of an integrity verdict in seconds. */
export const DEFAULT_MAX_AGE_SECONDS = 120;

/** The subset of the Play Integrity verdict used by the shortener. */
export interface IntegrityPayload {
    requestDetails?: {
        requestPackageName?: string;
        requestHash?: string;
        timestampMillis?: string | number;
    };
    appIntegrity?: {
        appRecognitionVerdict?: string;
        packageName?: string;
        certificateSha256Digest?: string[];
    };
    deviceIntegrity?: {
        deviceRecognitionVerdict?: string[];
    };
    accountDetails?: {
        appLicensingVerdict?: string;
    };
}

/** Result of evaluating a verdict against the configured policy. */
export interface IntegrityResult {
    verified: boolean;
    reason: string;
    deviceVerdicts: string[];
}

let authClientPromise: Promise<AuthClient> | undefined;

/**
 * Build the canonical payload that the client hashes for the Play Integrity
 * request hash. Keep this in sync with the app (same field order and values).
 * @param apiKey Application key from the query string
 * @param uri Target URI exactly as the client sent it
 * @param timestamp Client timestamp in milliseconds
 */
export function canonicalPayload(apiKey: string, uri: string, timestamp: string): string {
    return [INTEGRITY_PAYLOAD_VERSION, apiKey, uri, timestamp].join('\n');
}

/**
 * Hash a canonical payload as a base64url SHA-256 digest.
 * @param payload Canonical payload
 */
export function hashPayload(payload: string): string {
    return crypto.createHash('sha256').update(payload).digest('base64url');
}

/**
 * Normalise a certificate digest for comparison (Play returns colon-separated
 * uppercase hex, while configuration may use any case and separators).
 * @param digest Certificate digest
 */
function normalizeDigest(digest: string): string {
    return digest.replace(/:/g, '').toLowerCase();
}

function rejected(reason: string, deviceVerdicts: string[] = []): IntegrityResult {
    return { verified: false, reason, deviceVerdicts };
}

/**
 * Evaluate a decoded Play Integrity verdict against the application policy.
 * @param payload Decoded token payload
 * @param expectedHash Expected request hash
 * @param config Integrity policy of the application
 * @param now Current time in milliseconds (injectable for tests)
 */
export function evaluateVerdict(
    payload: IntegrityPayload | undefined,
    expectedHash: string,
    config: IntegrityConfig,
    now: number = Date.now(),
): IntegrityResult {
    if (!payload) {
        return rejected('missing payload');
    }
    const request = payload.requestDetails ?? {};
    const app = payload.appIntegrity ?? {};
    const device = payload.deviceIntegrity ?? {};
    const account = payload.accountDetails ?? {};
    const deviceVerdicts = device.deviceRecognitionVerdict ?? [];

    if (!request.requestHash || request.requestHash !== expectedHash) {
        return rejected('request hash mismatch', deviceVerdicts);
    }
    const timestamp = Number(request.timestampMillis);
    const maxAge = (config.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS) * 1000;
    if (!Number.isFinite(timestamp) || now - timestamp > maxAge || timestamp - now > 60_000) {
        return rejected('stale verdict', deviceVerdicts);
    }
    if (request.requestPackageName !== config.packageName) {
        return rejected('package name mismatch', deviceVerdicts);
    }
    if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
        return rejected('app not recognized', deviceVerdicts);
    }
    if (config.certificateDigests && config.certificateDigests.length > 0) {
        const expected = new Set(config.certificateDigests.map(normalizeDigest));
        const actual = (app.certificateSha256Digest ?? []).map(normalizeDigest);
        if (!actual.some((digest) => expected.has(digest))) {
            return rejected('certificate mismatch', deviceVerdicts);
        }
    }
    if (account.appLicensingVerdict !== 'LICENSED') {
        return rejected('app not licensed', deviceVerdicts);
    }
    const required = config.requiredDeviceVerdicts ?? ['MEETS_DEVICE_INTEGRITY'];
    if (!required.some((verdict) => deviceVerdicts.includes(verdict))) {
        return rejected('device integrity too low', deviceVerdicts);
    }
    return { verified: true, reason: 'verified', deviceVerdicts };
}

/**
 * Decode an integrity token with the Play Integrity API (server-side, using
 * application default credentials). This is the only place that talks to Google.
 * @param token Integrity token from the client
 * @param packageName Android package name
 */
export async function decodeIntegrityToken(token: string, packageName: string): Promise<IntegrityPayload> {
    if (authClientPromise === undefined) {
        authClientPromise = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/playintegrity'],
        }).getClient();
    }
    const client = await authClientPromise;
    const access = await client.getAccessToken();
    if (!access.token) {
        throw new Error('Could not obtain a Google access token');
    }
    const response = await fetch(
        `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ integrity_token: token }),
        },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Play Integrity decode failed (${response.status}): ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as { tokenPayloadExternal?: IntegrityPayload };
    if (!data.tokenPayloadExternal) {
        throw new Error('Play Integrity response has no token payload');
    }
    return data.tokenPayloadExternal;
}
