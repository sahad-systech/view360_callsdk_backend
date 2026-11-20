# LiveKit token server

An Express MVC API that issues one-hour LiveKit room access tokens.

## Run

Install dependencies with `npm install`. Set `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, and `LIVEKIT_URL` in `.env`. Optionally set `PORT`
(defaults to `3000`). Run `npm start`, or `npm run dev` for automatic reloads.

## Local LiveKit server (Windows)

The token API and the LiveKit media server are separate processes. Start both:

```powershell
npm run livekit
# In a second terminal:
npm start
```

The local launcher uses the same API key and secret from `.env`, listens on
`127.0.0.1:7880`, and enables local WebRTC connections on TCP 7881 / UDP 7882.
Set `LIVEKIT_URL=ws://127.0.0.1:7880` for clients on this computer.
This loopback setup is for local development; other devices need a reachable
server address and network configuration.

LiveKit v1.13.11 for Windows is installed under `.local/livekit` (ignored by Git).
On a fresh checkout, download the Windows archive from the
[official releases](https://github.com/livekit/livekit/releases/tag/v1.13.11),
verify it against the release's `checksums.txt`, and extract it so
`.local/livekit/livekit-server.exe` exists.
See the [local server guide](https://docs.livekit.io/transport/self-hosting/local/).

## Structure

- `src/models/token.js`: LiveKit token creation and room permissions.
- `src/views/json.js`: JSON response representations (the API's view layer).
- `src/controllers/`: Request validation and coordination of models and views.
- `src/routes/index.js`: HTTP endpoint mappings.
- `src/config/environment.js`: Environment loading and configuration validation.
- `src/app.js`: Express middleware and routes; exports the app for testing.
- `src/server.js`: Starts the HTTP listener.

## API

- `GET /` displays the welcome page and API usage instructions.
- `GET /health` returns `{ "status": "ok" }`.
- `POST /token` accepts `{ "roomName": "demo", "participantName": "alice" }`
  and returns `serverUrl`, `participantName`, `roomName`, and `token`.
  Tokens permit joining the named room, publishing, subscribing, and publishing
  data. Missing required fields return HTTP 400; generation failures return 500.

Run `npm test` to verify the HTTP responses and signed token permissions using
test credentials. No LiveKit connection is required.
