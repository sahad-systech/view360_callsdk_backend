const db = require("../config/database");

class Call {
  static async create({ id, callerId, receiverId, roomName, status = "ringing" }) {
    const text = `
      INSERT INTO calls (id, caller_id, receiver_id, room_name, status, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at;
    `;
    const values = [id, callerId, receiverId, roomName, status];
    const { rows } = await db.query(text, values);
    const row = rows[0];
    return {
      callId: row.id,
      callerId: row.caller_id,
      receiverId: row.receiver_id,
      roomName: row.room_name,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    };
  }

  static async findById(id) {
    if (!id) return null;
    const text = `
      SELECT id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at
      FROM calls
      WHERE id = $1
      LIMIT 1;
    `;
    try {
      const { rows } = await db.query(text, [id]);
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        callId: row.id,
        callerId: row.caller_id,
        receiverId: row.receiver_id,
        roomName: row.room_name,
        status: row.status,
        createdAt: row.created_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async accept({ id, receiverId }) {
    if (!id || !receiverId) return null;
    const text = `
      UPDATE calls
      SET status = 'accepted', started_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND receiver_id = $2 AND status = 'ringing'
      RETURNING id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at;
    `;
    try {
      const { rows } = await db.query(text, [id, receiverId]);
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        callId: row.id,
        callerId: row.caller_id,
        receiverId: row.receiver_id,
        roomName: row.room_name,
        status: row.status,
        createdAt: row.created_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }
}

module.exports = Call;
