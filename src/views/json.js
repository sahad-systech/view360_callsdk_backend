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

function callRejected(call) {
  return {
    success: true,
    message: "Call rejected successfully",
    data: {
      callId: call.callId,
      status: call.status,
      endedAt: call.endedAt,
    },
  };
}

function callEnded(call) {
  return {
    success: true,
    message: "Call ended successfully",
    data: {
      callId: call.callId,
      callerId: call.callerId,
      receiverId: call.receiverId,
      roomName: call.roomName,
      status: call.status,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      duration: call.duration ?? null,
    },
  };
}

function callDetails(call) {
  return {
    success: true,
    message: "Call details retrieved successfully",
    data: {
      callId: call.callId,
      callerId: call.callerId,
      receiverId: call.receiverId,
      roomName: call.roomName,
      status: call.status,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      duration: call.duration ?? null,
    },
  };
}

function callHistory({ calls, pagination }) {
  return {
    success: true,
    message: "Call history retrieved successfully",
    data: calls,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      totalRecords: pagination.totalRecords,
      totalPages: pagination.totalPages,
    },
  };
}

function callCancelled(call) {
  return {
    success: true,
    message: "Call cancelled successfully",
    data: {
      callId: call.callId,
      status: call.status,
      endedAt: call.endedAt,
    },
  };
}

function fcmTokenRegistered(tokenRecord) {
  return {
    success: true,
    message: "FCM token registered successfully",
    data: {
      id: tokenRecord.id,
      userId: tokenRecord.userId,
      fcmToken: tokenRecord.fcmToken,
      deviceType: tokenRecord.deviceType,
      deviceId: tokenRecord.deviceId,
      createdAt: tokenRecord.createdAt,
      updatedAt: tokenRecord.updatedAt,
    },
  };
}

function fcmTokensList(tokens) {
  return {
    success: true,
    message: "FCM tokens retrieved successfully",
    data: tokens,
  };
}

function fcmTokenRemoved() {
  return {
    success: true,
    message: "FCM token removed successfully",
  };
}

function apiError(message) {
  return {
    success: false,
    message,
  };
}

module.exports = {
  token,
  health,
  error,
  callInitiated,
  callAccepted,
  callRejected,
  callEnded,
  callDetails,
  callHistory,
  callCancelled,
  fcmTokenRegistered,
  fcmTokensList,
  fcmTokenRemoved,
  apiError,
};
