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

function callInitiated(call) {
  return {
    success: true,
    message: "Call initiated successfully",
    data: {
      callId: call.callId,
      callerId: call.callerId,
      receiverId: call.receiverId,
      roomName: call.roomName,
      status: call.status,
    },
  };
}

function callAccepted({ call, serverUrl, caller, receiver }) {
  return {
    success: true,
    message: "Call accepted successfully",
    data: {
      callId: call.callId,
      roomName: call.roomName,
      serverUrl,
      caller: {
        participantName: caller.participantName,
        token: caller.token,
      },
      receiver: {
        participantName: receiver.participantName,
        token: receiver.token,
      },
      status: call.status,
    },
  };
}

function apiError(message) {
  return {
    success: false,
    message,
  };
}

module.exports = { token, health, error, callInitiated, callAccepted, apiError };
