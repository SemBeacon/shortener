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
- your-server.com/shorten **->** /api/shorten
- your-short-url.com/ **->** /

#### Environment Variables
This URL shortener requires Redis to function.

### Configuration
```json
{
    "applications": [
        {
            "id": "example",
            "name": "Example Application",
            "key": "test123",
            "maxLength": 5,
            "url": "https://sembeacon.org/s/"
        }
    ],
    "port": "4899",
    "log": {
        "level": "debug"
    }
}
```

#### `url`
The URL prefix to use for the shortener.

#### `maxLength`
The maximum length of random characters to append to the `url`.

### Docker

## Contributors
The framework is open source and is mainly developed by PhD Student Maxim Van de Wynckel as part of his research towards *Interoperable and Discoverable Indoor Positioning Systems* under the supervision of Prof. Dr. Beat Signer.

## Contributing
Use of OpenHPS, SemBeacon, contributions and feedback is highly appreciated. Please read our [contributing guidelines](CONTRIBUTING.md) for more information.

## License
Copyright (C) 2019-2024 Maxim Van de Wynckel & Vrije Universiteit Brussel

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.