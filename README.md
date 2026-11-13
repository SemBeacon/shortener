<h1 align="center">
  <img alt="SemBeacon" src="https://sembeacon.org/images/logo.svg" width="50%" /><br />
  @sembeacon/shortener
</h1>

<br />

This repository contains a server for shortening URLs for SemBeacon.

## Usage

### Installation
```text
yarn install
```

#### Reverse Proxy
You will have to configure a reverse proxy to direct to the following URLs:
- `your-server.com/shorten` **->** `127.0.0.1:4899/shorten/<app>`
- `your-short-url.com` **->** `127.0.0.1:4899/s/<app>`
where `<app>` is the application ID.

#### Environment Variables
This URL shortener requires Redis to function. Redis is used to store the shortened URLs. The following environment variables are required:
- `REDIS_USER`: The username for the Redis server.
- `REDIS_PASSWORD`: The password for the Redis server.
- `REDIS_HOST`: The host of the Redis server.
- `REDIS_PORT`: The port of the Redis server.

### Configuration
```json
{
    "applications": [
        {
            "id": "example",
            "name": "Example Application",
            "key": "test123",
            "maxLength": 5,
            "url": "https://s.sembeacon.org/",
            "characters": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$-_.+!*'(),",
            "allowedSchemes": ["https:", "http:"],
            "rateLimit": {
                "windowSeconds": 60,
                "max": 60
            }
        }
    ],
    "port": "4899",
    "log": {
        "level": "debug"
    }
}
```

#### `id`
A unique identifier for the application.

#### `name`
The name of the application for logging purposes.

#### `key`
Public client identifier used by the application. It is required to shorten
URLs, but it is not a secret: it ships with the client. Use the rate limit to
contain abuse and rotate a key if it is misused.

#### `url`
The URL prefix to use for the shortener.

#### `maxLength`
The maximum length of random characters to append to the `url`.

#### `characters`
The characters to use for the random string. By default it will use all URI-safe characters.
Identifiers are generated with a cryptographically secure random source.

#### `allowedSchemes`
Accepted URI schemes. Default: `["https:", "http:"]`. Other schemes
(`file:`, `javascript:`, `data:` and so on) are always rejected.

#### `allowDomains`
Optional allow list of hostnames that this application may shorten, for example
`["sembeacon.org", "example.org"]`. Subdomains are included. When omitted, any
public host is allowed, so existing clients keep working.

#### `rateLimit`
Per-application rate limit, applied per client IP and shared through Redis:

```json
"rateLimit": {
    "windowSeconds": 60,
    "max": 300
}
```

Default: 300 requests per 60 seconds. This is deliberately generous so an
unconfigured deployment does not throttle existing clients.

### Security

- Only absolute `http`/`https` URIs without credentials are accepted.
- Loopback, private, link-local and reserved IP addresses and local hostnames
  are rejected, and a link may never point at the shortener itself.
- Requests are rate limited per application and client IP.
- Logs contain the request path only, never the query string (which holds the
  API key and the target URI).
- Stored URIs are checked again before a redirect, so legacy rows cannot turn
  into a non-HTTP redirect.

### Play Integrity (optional)

The official app can attach a Play Integrity token to a shortening request.
This is **per application and non-blocking**: other services, older clients,
the web build and Google outages all keep using the anonymous tier.

```json
"integrity": {
    "enabled": true,
    "packageName": "org.sembeacon",
    "certificateDigests": ["<Play App Signing SHA-256>"],
    "requiredDeviceVerdicts": ["MEETS_DEVICE_INTEGRITY"],
    "maxAgeSeconds": 120,
    "verifiedRateLimit": {
        "windowSeconds": 60,
        "max": 1200
    }
}
```

- `certificateDigests` must be the **Play App Signing** certificate (Play
  Console → App integrity), not the upload key. Matching ignores case and
  colons.
- Requests send `X-Integrity-Token` and `X-Request-Timestamp` (milliseconds).
- The client hashes this exact payload (SHA-256, base64url) and passes it as
  the standard integrity request hash:

  ```
  sembeacon-shorten-v1
  <api key>
  <uri exactly as sent>
  <timestamp>
  ```

- The server decodes the token with
  `playintegrity.googleapis.com/v1/<package>:decodeIntegrityToken` using
  application default credentials (`GOOGLE_APPLICATION_CREDENTIALS` or the
  workload identity of the deployment). The service account needs the
  `https://www.googleapis.com/auth/playintegrity` scope.
- A verified request gets `verifiedRateLimit`; everything else gets
  `rateLimit`. A missing, invalid or unverifiable token **never** produces an
  error, so other clients are unaffected.
- Tokens are single use (Redis, 10 minutes) and verdicts older than
  `maxAgeSeconds` are rejected.

### API
1. Shorten an URL
```
GET http://localhost:4899/shorten/example?api=test123&uri=https://maximvdw.be
```

On Android the official app adds:

```
X-Integrity-Token: <Play Integrity token>
X-Request-Timestamp: <milliseconds>
```
2. Response
```text
https://s.sembeacon.org/AkGLs
```
3. Access the shortened URL
(local URL: `http://localhost:4899/s/example/AkGLs`)

### Docker
A docker file is available on [Docker Hub](https://hub.docker.com/r/sembeacon/shortener/tags). You can run the following command to start the server:
```bash
docker run -d -p 4899:4899 -e REDIS_USER=redis -e REDIS_PASSWORD=redis -e REDIS_HOST=redis -e REDIS_PORT=6379 sembeacon/shortener
```
Override the `config.json` file located in `/opt/shortener/config.json` with your own configuration.

## Contributors
The framework is open source and is mainly developed by Dr. Maxim Van de Wynckel as part of his PhD research towards *Interoperable and Discoverable Indoor Positioning Systems* under the supervision of Prof. Dr. Beat Signer.

## Contributing
Use of OpenHPS, SemBeacon, contributions and feedback is highly appreciated. Please read our [contributing guidelines](CONTRIBUTING.md) for more information.

## License
Copyright (C) 2019-2026 Maxim Van de Wynckel & Vrije Universiteit Brussel

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.