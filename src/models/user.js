const db = require("../config/database");

class User {
  static async findById(id) {
    if (!id) return null;
    const text = `
      SELECT id, name, email, created_at
      FROM users
      WHERE id::text = $1 OR name = $1 OR email = $1
      LIMIT 1;
    `;
    try {
      const { rows } = await db.query(text, [id]);
      return rows[0] || null;
    } catch (error) {
      // 22P02 is PostgreSQL's invalid_text_representation (e.g. invalid UUID format)
      if (error.code === "22P02") {
        return null;
      }
      throw error;
    }
  }

  static async create({ id, name, email }) {
    const text = `
      INSERT INTO users (id, name, email)
      VALUES (COALESCE($1, gen_random_uuid()), $2, $3)
      RETURNING id, name, email, created_at;
    `;
    const { rows } = await db.query(text, [id || null, name, email || null]);
    return rows[0];
  }
}

module.exports = User;
