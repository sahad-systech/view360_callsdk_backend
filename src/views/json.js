// This API's views serialize JSON rather than render HTML templates.
function token({ serverUrl, participantName, roomName, token }) {
  return { serverUrl, participantName, roomName, token };
}

function health() {
  return { status: "ok" };
}

function error(message) {
  return { error: message };
}

module.exports = { token, health, error };
