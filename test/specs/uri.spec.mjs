import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    generateIdentifier,
    isAllowedDomain,
    isBlockedAddress,
    isBlockedHostname,
    isSelfReference,
    ShortenRequestError,
    validateShortenUri,
} from '../../dist/esm/security/uri.js';

const application = {
    id: 'example',
    name: 'Example',
    key: 'test123',
    maxLength: 5,
    url: 'https://s.example.org/',
    characters: 'abcdefghijklmnopqrstuvwxyz0123456789',
};

describe('isBlockedAddress', () => {
    it('blocks loopback, private and link-local IPv4 ranges', () => {
        ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1'].forEach((address) =>
            assert.equal(isBlockedAddress(address), true, address),
        );
    });

    it('allows public IPv4 addresses', () => {
        ['8.8.8.8', '1.1.1.1', '93.184.216.34'].forEach((address) =>
            assert.equal(isBlockedAddress(address), false, address),
        );
    });

    it('blocks loopback, link-local and unique-local IPv6 ranges', () => {
        ['::1', 'fe80::1', 'fc00::1'].forEach((address) => assert.equal(isBlockedAddress(address), true, address));
    });

    it('allows public IPv6 addresses', () => {
        assert.equal(isBlockedAddress('2606:4700:4700::1111'), false);
    });
});

describe('isBlockedHostname', () => {
    it('blocks local hostnames', () => {
        ['localhost', 'localhost.', 'api.localhost', 'printer.local', 'db.internal', 'router.home.arpa'].forEach(
            (hostname) => assert.equal(isBlockedHostname(hostname), true, hostname),
        );
    });

    it('allows public hostnames', () => {
        ['sembeacon.org', 's.sembeacon.org', 'example.com'].forEach((hostname) =>
            assert.equal(isBlockedHostname(hostname), false, hostname),
        );
    });
});

describe('isAllowedDomain', () => {
    it('allows everything when no allow list is configured', () => {
        assert.equal(isAllowedDomain('example.com'), true);
        assert.equal(isAllowedDomain('example.com', []), true);
    });

    it('matches exact domains and subdomains', () => {
        assert.equal(isAllowedDomain('example.com', ['example.com']), true);
        assert.equal(isAllowedDomain('data.example.com', ['example.com']), true);
        assert.equal(isAllowedDomain('.example.com', ['example.com']), true);
    });

    it('does not match lookalike domains', () => {
        assert.equal(isAllowedDomain('example.com.evil.test', ['example.com']), false);
        assert.equal(isAllowedDomain('notexample.com', ['example.com']), false);
    });
});

describe('isSelfReference', () => {
    it('detects links to the shortener itself', () => {
        assert.equal(isSelfReference(application, new URL('https://s.example.org/abc')), true);
        assert.equal(isSelfReference(application, new URL('https://example.org/abc')), false);
    });
});

describe('validateShortenUri', () => {
    it('accepts http and https URIs and normalises them', () => {
        assert.equal(validateShortenUri(application, 'https://example.com').href, 'https://example.com/');
        assert.equal(validateShortenUri(application, 'http://example.com/a').protocol, 'http:');
    });

    it('rejects unsupported schemes', () => {
        ['file:///etc/passwd', 'ftp://example.com/a', 'javascript:alert(1)', 'data:text/plain,hello'].forEach((uri) => {
            assert.throws(() => validateShortenUri(application, uri), (error) => {
                assert.ok(error instanceof ShortenRequestError);
                assert.equal(error.status, 400);
                return true;
            });
        });
    });

    it('respects a per-application scheme allow list', () => {
        assert.throws(() => validateShortenUri({ ...application, allowedSchemes: ['https:'] }, 'http://example.com'));
    });

    it('rejects credentials, local hosts and private addresses', () => {
        ['https://user:pass@example.com/', 'https://localhost/a', 'http://127.0.0.1/', 'http://[::1]/'].forEach((uri) => {
            assert.throws(() => validateShortenUri(application, uri), ShortenRequestError, uri);
        });
    });

    it('rejects links back to the shortener', () => {
        assert.throws(() => validateShortenUri(application, 'https://s.example.org/abc'), ShortenRequestError);
    });

    it('enforces an optional domain allow list', () => {
        const restricted = { ...application, allowDomains: ['sembeacon.org'] };
        assert.equal(validateShortenUri(restricted, 'https://sembeacon.org/a').hostname, 'sembeacon.org');
        assert.throws(() => validateShortenUri(restricted, 'https://example.com/a'), ShortenRequestError);
    });

    it('rejects empty, oversized and control-character URIs', () => {
        assert.throws(() => validateShortenUri(application, ''), ShortenRequestError);
        assert.throws(
            () => validateShortenUri(application, `https://example.com/${'a'.repeat(2048)}`),
            ShortenRequestError,
        );
        assert.throws(() => validateShortenUri(application, 'https://example.com/\r\nX-Test: 1'), ShortenRequestError);
    });
});

describe('generateIdentifier', () => {
    it('uses the configured alphabet and length', () => {
        const identifier = generateIdentifier('abc', 32);
        assert.equal(identifier.length, 32);
        assert.match(identifier, /^[abc]+$/);
    });

    it('generates different identifiers', () => {
        assert.notEqual(generateIdentifier('abcdef0123456789', 40), generateIdentifier('abcdef0123456789', 40));
    });
});
