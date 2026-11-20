const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { livekit } = require("../src/config/environment");

const executable = path.join(__dirname, "../.local/livekit/livekit-server.exe");
if (!fs.existsSync(executable)) {
  throw new Error("Install the official Windows LiveKit server in .local/livekit first (see README.md).");
}

// Pass credentials through the child environment, never command-line arguments.
const child = spawn(executable, ["--bind", "127.0.0.1", "--node-ip", "127.0.0.1"], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    LIVEKIT_CONFIG: JSON.stringify({
      port: 7880,
      rtc: { tcp_port: 7881, udp_port: 7882, use_external_ip: false, enable_loopback_candidate: true },
      keys: { [livekit.apiKey]: livekit.apiSecret },
    }),
  },
});

child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
