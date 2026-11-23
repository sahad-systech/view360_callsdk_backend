const db = require("../config/database");

function formatRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    fcmToken: row.fcm_token,
    deviceType: row.device_type,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class FcmToken {
  static async upsert({ userId, fcmToken, deviceType, deviceId = null }) {
    if (!userId || !fcmToken || !deviceType) return null;

    const text = `
      INSERT INTO user_fcm_tokens (user_id, fcm_token, device_type, device_id, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (fcm_token) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          device_type = EXCLUDED.device_type,
          device_id = EXCLUDED.device_id,
          updated_at = CURRENT_TIMESTAMP
      RETURNING id, user_id, fcm_token, device_type, device_id, created_at, updated_at;
    `;
    const values = [userId, fcmToken, deviceType.toLowerCase(), deviceId || null];

    try {
      const { rows } = await db.query(text, values);
      return formatRow(rows[0]);
    } catch (error) {
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async deleteToken({ userId, fcmToken }) {
    if (!userId || !fcmToken) return false;

    const text = `
      DELETE FROM user_fcm_tokens
      WHERE fcm_token = $1 AND user_id = $2
      RETURNING id, fcm_token;
    `;

    try {
      const { rows } = await db.query(text, [fcmToken, userId]);
      return rows.length > 0;
    } catch (error) {
      if (error.code === "22P02") {
        return false;
      }
      throw error;
    }
  }

  static async findByUserId(userId) {
    if (!userId) return [];

    const text = `
      SELECT id, user_id, fcm_token, device_type, device_id, created_at, updated_at
      FROM user_fcm_tokens
      WHERE user_id = $1
      ORDER BY updated_at DESC;
    `;

    try {
      const { rows } = await db.query(text, [userId]);
      return rows.map(formatRow);
    } catch (error) {
      if (error.code === "22P02") {
        return [];
      }
      throw error;
    }
  }

  static async deleteMultipleTokens(tokens) {
    if (!tokens || tokens.length === 0) return 0;

    const text = `
      DELETE FROM user_fcm_tokens
      WHERE fcm_token = ANY($1::text[])
      RETURNING id;
    `;

    try {
      const { rows } = await db.query(text, [tokens]);
      return rows.length;
    } catch (error) {
      console.error("Error deleting multiple tokens:", error);
      return 0;
    }
  }
}

module.exports = FcmToken;
