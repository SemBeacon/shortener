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
            "characters": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$-_.+!*'(),"
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
The key to use for the application. This key is required to shorten URLs. If possible, try to keep this key secret.

#### `url`
The URL prefix to use for the shortener.

#### `maxLength`
The maximum length of random characters to append to the `url`.

#### `characters`
The characters to use for the random string. By default it will use all URI-safe characters.

### API
1. Shorten an URL
```
GET http://localhost:4899/shorten/example?api=test123&uri=https://maximvdw.be
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
The framework is open source and is mainly developed by PhD Student Maxim Van de Wynckel as part of his research towards *Interoperable and Discoverable Indoor Positioning Systems* under the supervision of Prof. Dr. Beat Signer.

## Contributing
Use of OpenHPS, SemBeacon, contributions and feedback is highly appreciated. Please read our [contributing guidelines](CONTRIBUTING.md) for more information.

## License
Copyright (C) 2019-2025 Maxim Van de Wynckel & Vrije Universiteit Brussel

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.