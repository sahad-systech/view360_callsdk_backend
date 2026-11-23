const db = require("../config/database");

function formatRow(row) {
  if (!row) return null;
  const startedAt = row.started_at ? new Date(row.started_at) : null;
  const endedAt = row.ended_at ? new Date(row.ended_at) : null;
  const duration =
    startedAt && endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

  return {
    callId: row.id,
    callerId: row.caller_id,
    receiverId: row.receiver_id,
    roomName: row.room_name,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    duration,
  };
}

class Call {
  static async create({ id, callerId, receiverId, roomName, status = "ringing" }) {
    const text = `
      INSERT INTO calls (id, caller_id, receiver_id, room_name, status, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at;
    `;
    const values = [id, callerId, receiverId, roomName, status];
    const { rows } = await db.query(text, values);
    return formatRow(rows[0]);
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
      return formatRow(rows[0]);
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
      return formatRow(rows[0]);
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async reject({ id, receiverId }) {
    if (!id || !receiverId) return null;
    const text = `
      UPDATE calls
      SET status = 'rejected', ended_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND receiver_id = $2 AND status = 'ringing'
      RETURNING id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at;
    `;
    try {
      const { rows } = await db.query(text, [id, receiverId]);
      return formatRow(rows[0]);
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async cancel({ id, callerId }) {
    if (!id || !callerId) return null;
    const text = `
      UPDATE calls
      SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND caller_id = $2 AND status = 'ringing'
      RETURNING id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at;
    `;
    try {
      const { rows } = await db.query(text, [id, callerId]);
      return formatRow(rows[0]);
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async end({ id, userId }) {
    if (!id || !userId) return null;
    const text = `
      UPDATE calls
      SET status = 'ended', ended_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND (caller_id = $2 OR receiver_id = $2) AND status = 'accepted'
      RETURNING id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at;
    `;
    try {
      const { rows } = await db.query(text, [id, userId]);
      return formatRow(rows[0]);
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async findHistory({ userId, page = 1, limit = 20 }) {
    if (!userId) return { calls: [], pagination: { page, limit, totalRecords: 0, totalPages: 0 } };

    const offset = (page - 1) * limit;

    const countText = `
      SELECT COUNT(*)::int AS total
      FROM calls
      WHERE caller_id = $1 OR receiver_id = $1;
    `;
    const listText = `
      SELECT id, caller_id, receiver_id, room_name, status, created_at, started_at, ended_at
      FROM calls
      WHERE caller_id = $1 OR receiver_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    try {
      const [countResult, listResult] = await Promise.all([
        db.query(countText, [userId]),
        db.query(listText, [userId, limit, offset]),
      ]);

      const totalRecords = countResult.rows[0]?.total || 0;
      const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / limit) : 0;

      const calls = listResult.rows.map((row) => {
        const formatted = formatRow(row);
        const direction = formatted.callerId === userId ? "outgoing" : "incoming";
        return {
          callId: formatted.callId,
          callerId: formatted.callerId,
          receiverId: formatted.receiverId,
          direction,
          status: formatted.status,
          createdAt: formatted.createdAt,
          startedAt: formatted.startedAt,
          endedAt: formatted.endedAt,
          duration: formatted.duration,
        };
      });

      return {
        calls,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages,
        },
      };
    } catch (error) {
      if (error.code === "22P02") {
        return { calls: [], pagination: { page, limit, totalRecords: 0, totalPages: 0 } };
      }
      throw error;
    }
  }
}

module.exports = Call;
