import crypto from 'node:crypto';
import net from 'node:net';
import { Application } from '../models/Application.model.js';

/** Maximum length of a URI accepted by the shortener. */
export const MAX_URI_LENGTH = 2048;

/** Schemes accepted when an application does not configure its own list. */
export const DEFAULT_SCHEMES = ['https:', 'http:'];

/** An error that maps directly to an HTTP status code. */
export class ShortenRequestError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ShortenRequestError';
        this.status = status;
    }
}

const BLOCKED_IPV4 = new net.BlockList();
[
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
].forEach(([address, prefix]) => BLOCKED_IPV4.addSubnet(address as string, prefix as number, 'ipv4'));

const BLOCKED_IPV6 = new net.BlockList();
[
    ['::', 128],
    ['::1', 128],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
].forEach(([address, prefix]) => BLOCKED_IPV6.addSubnet(address as string, prefix as number, 'ipv6'));

/**
 * Whether an IP address is in a range that must not be shortened.
 * @param address IPv4 or IPv6 address
 */
export function isBlockedAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        return BLOCKED_IPV4.check(address, 'ipv4');
    }
    if (net.isIPv6(address)) {
        const lower = address.toLowerCase();
        if (lower.startsWith('::ffff:')) {
            const mapped = address.slice(7);
            if (net.isIPv4(mapped)) {
                return BLOCKED_IPV4.check(mapped, 'ipv4');
            }
        }
        return BLOCKED_IPV6.check(address, 'ipv6');
    }
    return true;
}

/**
 * Remove the brackets from an IPv6 literal hostname.
 * @param hostname Hostname, possibly `[::1]`
 */
export function normalizeHostname(hostname: string): string {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Whether a hostname is local and must not be shortened.
 * @param hostname Hostname to check
 */
export function isBlockedHostname(hostname: string): boolean {
    const host = normalizeHostname(hostname).toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host === 'localhost.localdomain') {
        return true;
    }
    return ['.localhost', '.local', '.internal', '.home.arpa'].some((suffix) => host.endsWith(suffix));
}

/**
 * Whether a URI points at the shortener's own domain.
 * @param app Application configuration
 * @param uri URI to check
 */
export function isSelfReference(app: Application, uri: URL): boolean {
    try {
        return new URL(app.url).hostname.toLowerCase() === uri.hostname.toLowerCase();
    } catch {
        return false;
    }
}

/**
 * Whether a hostname is allowed by the optional per-application allow list.
 * @param hostname Hostname to check
 * @param allowDomains Configured domains (empty or undefined allows everything)
 */
export function isAllowedDomain(hostname: string, allowDomains?: string[]): boolean {
    if (!allowDomains || allowDomains.length === 0) {
        return true;
    }
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return allowDomains.some((entry) => {
        const domain = entry.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
        return host === domain || host.endsWith(`.${domain}`);
    });
}

/**
 * Whether a string contains ASCII control characters.
 * @param value Input string
 */
function hasControlCharacters(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f) {
            return true;
        }
    }
    return false;
}

/**
 * Validate the URI that a client wants to shorten.
 * @param app Application configuration
 * @param raw URI from the query string
 */
export function validateShortenUri(app: Application, raw: string): URL {
    if (!raw || raw.length > MAX_URI_LENGTH || hasControlCharacters(raw)) {
        throw new ShortenRequestError(400, 'Please provide a valid uri= GET parameter!');
    }
    let uri: URL;
    try {
        uri = new URL(raw);
    } catch {
        throw new ShortenRequestError(400, 'Please provide a valid uri= GET parameter!');
    }
    const schemes = (app.allowedSchemes ?? DEFAULT_SCHEMES).map((scheme) =>
        scheme.endsWith(':') ? scheme.toLowerCase() : `${scheme.toLowerCase()}:`,
    );
    if (!schemes.includes(uri.protocol)) {
        throw new ShortenRequestError(400, 'Unsupported URI scheme!');
    }
    if (uri.username || uri.password) {
        throw new ShortenRequestError(400, 'URIs with credentials are not supported!');
    }
    if (
        !uri.hostname ||
        isBlockedHostname(uri.hostname) ||
        (net.isIP(normalizeHostname(uri.hostname)) !== 0 && isBlockedAddress(normalizeHostname(uri.hostname)))
    ) {
        throw new ShortenRequestError(400, 'Private and local URIs are not supported!');
    }
    if (isSelfReference(app, uri)) {
        throw new ShortenRequestError(400, 'Cannot shorten a link to the shortener itself!');
    }
    if (!isAllowedDomain(uri.hostname, app.allowDomains)) {
        throw new ShortenRequestError(400, 'Domain is not allowed for this application!');
    }
    return uri;
}

/**
 * Generate a random short identifier with a cryptographically secure source.
 * @param characters Alphabet to draw from
 * @param length Number of characters
 */
export function generateIdentifier(characters: string, length: number): string {
    let result = '';
    for (let counter = 0; counter < length; counter++) {
        result += characters[crypto.randomInt(characters.length)];
    }
    return result;
}
