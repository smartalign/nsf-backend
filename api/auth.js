import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getConnection } from "./db.js";
import { requireAdminAuth } from "./authMiddleware.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const DEFAULT_ADMIN_TABLE = "admin_users";
const PRIMARY_SUPER_ADMIN_USERNAME = (
  process.env.PRIMARY_SUPER_ADMIN_USERNAME || "albert baiyekusi"
)
  .trim()
  .toLowerCase();
const PRIMARY_SUPER_ADMIN_PASSWORD =
  process.env.PRIMARY_SUPER_ADMIN_PASSWORD ||
  process.env.DEFAULT_ADMIN_PASSWORD ||
  "admin123";

let adminTableReadyPromise = null;

const getAdminTableName = () => {
  const configuredTable = process.env.ADMIN_TABLE || DEFAULT_ADMIN_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_ADMIN_TABLE;
};

const createToken = (admin) =>
  jwt.sign(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role || "admin",
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );

const isPrimarySuperAdmin = (adminLike) =>
  String(adminLike?.username || "").trim().toLowerCase() ===
    PRIMARY_SUPER_ADMIN_USERNAME &&
  String(adminLike?.role || "").trim().toLowerCase() === "super_admin";

const ensureAdminTableReady = async () => {
  if (!adminTableReadyPromise) {
    adminTableReadyPromise = (async () => {
      const connection = await getConnection();
      const tableName = getAdminTableName();

      try {
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'admin',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const defaultHash = await bcrypt.hash(PRIMARY_SUPER_ADMIN_PASSWORD, 10);
        await connection.execute(
          `INSERT INTO ${tableName} (username, password_hash, role, is_active)
           SELECT ?, ?, 'super_admin', 1
           WHERE NOT EXISTS (
             SELECT 1 FROM ${tableName} WHERE LOWER(username) = LOWER(?)
           )`,
          [
            PRIMARY_SUPER_ADMIN_USERNAME,
            defaultHash,
            PRIMARY_SUPER_ADMIN_USERNAME,
          ],
        );

        await connection.execute(
          `UPDATE ${tableName}
           SET role = 'super_admin', is_active = 1
           WHERE LOWER(username) = LOWER(?)`,
          [PRIMARY_SUPER_ADMIN_USERNAME],
        );

        await connection.execute(
          `UPDATE ${tableName}
           SET role = 'admin'
           WHERE role = 'super_admin'
             AND LOWER(username) <> LOWER(?)`,
          [PRIMARY_SUPER_ADMIN_USERNAME],
        );
      } finally {
        await connection.end();
      }
    })().catch((error) => {
      adminTableReadyPromise = null;
      throw error;
    });
  }

  return adminTableReadyPromise;
};

const getAdminByUsername = async (username) => {
  await ensureAdminTableReady();
  const connection = await getConnection();
  const tableName = getAdminTableName();

  try {
    const [rows] = await connection.execute(
      `SELECT id, username, password_hash, role, is_active
       FROM ${tableName}
       WHERE LOWER(username) = LOWER(?)
       LIMIT 1`,
      [username],
    );

    return rows[0] || null;
  } finally {
    await connection.end();
  }
};

const getAdminById = async (id) => {
  await ensureAdminTableReady();
  const connection = await getConnection();
  const tableName = getAdminTableName();

  try {
    const [rows] = await connection.execute(
      `SELECT id, username, password_hash, role, is_active
       FROM ${tableName}
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return rows[0] || null;
  } finally {
    await connection.end();
  }
};

const getManageableAdmins = async () => {
  await ensureAdminTableReady();
  const connection = await getConnection();
  const tableName = getAdminTableName();

  try {
    const [rows] = await connection.execute(
      `SELECT id, username, role, is_active
       FROM ${tableName}
       WHERE LOWER(username) <> LOWER(?)
       ORDER BY created_at DESC`,
      [PRIMARY_SUPER_ADMIN_USERNAME],
    );

    return rows;
  } finally {
    await connection.end();
  }
};

router.post("/login", async (req, res) => {
  if (!JWT_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Server configuration error: JWT secret is missing.",
    });
  }

  const username = req.body?.username?.trim();
  const password = req.body?.password;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required.",
    });
  }

  try {
    const admin = await getAdminByUsername(username);

    if (!admin || admin.is_active === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    const passwordHash = admin.password_hash || "";
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    const token = createToken(admin);

    return res.json({
      success: true,
      message: "Login successful.",
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role || "admin",
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process login right now.",
    });
  }
});

router.get("/me", (req, res) => {
  if (!JWT_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Server configuration error: JWT secret is missing.",
    });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Missing bearer token.",
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({
      success: true,
      admin: payload,
      permissions: {
        canManageAdmins: isPrimarySuperAdmin(payload),
      },
    });
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
});

router.post("/admins", requireAdminAuth, async (req, res) => {
  if (!isPrimarySuperAdmin(req.admin)) {
    return res.status(403).json({
      success: false,
      message: "Only Albert Baiyekusi can manage other admins.",
    });
  }

  const username = req.body?.username?.trim();
  const password = req.body?.password;
  const role = "admin";

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required.",
    });
  }

  if (String(password).length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters long.",
    });
  }

  try {
    await ensureAdminTableReady();
    const passwordHash = await bcrypt.hash(String(password), 10);
    const connection = await getConnection();
    const tableName = getAdminTableName();

    try {
      const [result] = await connection.execute(
        `INSERT INTO ${tableName} (username, password_hash, role, is_active)
         VALUES (?, ?, ?, 1)`,
        [username, passwordHash, role],
      );

      return res.status(201).json({
        success: true,
        message: "Admin account created successfully.",
        admin: {
          id: result.insertId,
          username,
          role,
        },
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An admin with this username already exists.",
      });
    }

    console.error("Create admin error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create admin account right now.",
    });
  }
});

router.get("/admins", requireAdminAuth, async (req, res) => {
  if (!isPrimarySuperAdmin(req.admin)) {
    return res.status(403).json({
      success: false,
      message: "Only Albert Baiyekusi can manage other admins.",
    });
  }

  try {
    const admins = await getManageableAdmins();
    return res.json({
      success: true,
      admins: admins.map((item) => ({
        id: item.id,
        username: item.username,
        role: item.role || "admin",
        isActive: Boolean(item.is_active),
      })),
    });
  } catch (error) {
    console.error("List admins error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch admins right now.",
    });
  }
});

router.patch("/admins/:id", requireAdminAuth, async (req, res) => {
  if (!isPrimarySuperAdmin(req.admin)) {
    return res.status(403).json({
      success: false,
      message: "Only Albert Baiyekusi can manage other admins.",
    });
  }

  const targetId = Number(req.params.id);
  const username = req.body?.username?.trim();
  const isActive = req.body?.isActive;

  if (!targetId || !username) {
    return res.status(400).json({
      success: false,
      message: "Target admin id and username are required.",
    });
  }

  const normalizedUsername = username.toLowerCase();
  if (normalizedUsername === PRIMARY_SUPER_ADMIN_USERNAME) {
    return res.status(400).json({
      success: false,
      message: "Primary super admin account cannot be edited here.",
    });
  }

  try {
    await ensureAdminTableReady();
    const connection = await getConnection();
    const tableName = getAdminTableName();
    try {
      const [existingRows] = await connection.execute(
        `SELECT id, username
         FROM ${tableName}
         WHERE id = ?
           AND LOWER(username) <> LOWER(?)
         LIMIT 1`,
        [targetId, PRIMARY_SUPER_ADMIN_USERNAME],
      );

      if (!existingRows[0]) {
        return res.status(404).json({
          success: false,
          message: "Admin not found.",
        });
      }

      await connection.execute(
        `UPDATE ${tableName}
         SET username = ?, role = 'admin', is_active = ?
         WHERE id = ?`,
        [username, isActive === false ? 0 : 1, targetId],
      );

      return res.json({
        success: true,
        message: "Admin updated successfully.",
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An admin with this username already exists.",
      });
    }

    console.error("Update admin error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update admin right now.",
    });
  }
});

router.post("/admins/:id/reset-password", requireAdminAuth, async (req, res) => {
  if (!isPrimarySuperAdmin(req.admin)) {
    return res.status(403).json({
      success: false,
      message: "Only Albert Baiyekusi can manage other admins.",
    });
  }

  const targetId = Number(req.params.id);
  const newPassword = req.body?.newPassword;

  if (!targetId || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Valid admin id and new password are required.",
    });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 6 characters long.",
    });
  }

  try {
    await ensureAdminTableReady();
    const connection = await getConnection();
    const tableName = getAdminTableName();
    try {
      const [rows] = await connection.execute(
        `SELECT id, username
         FROM ${tableName}
         WHERE id = ?
         LIMIT 1`,
        [targetId],
      );

      if (!rows[0]) {
        return res.status(404).json({
          success: false,
          message: "Admin not found.",
        });
      }

      if (
        String(rows[0].username || "").trim().toLowerCase() ===
        PRIMARY_SUPER_ADMIN_USERNAME
      ) {
        return res.status(400).json({
          success: false,
          message: "Primary super admin password cannot be reset here.",
        });
      }

      const passwordHash = await bcrypt.hash(String(newPassword), 10);
      await connection.execute(
        `UPDATE ${tableName}
         SET password_hash = ?
         WHERE id = ?`,
        [passwordHash, targetId],
      );

      return res.json({
        success: true,
        message: "Admin password reset successfully.",
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Reset admin password error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to reset admin password right now.",
    });
  }
});

router.delete("/admins/:id", requireAdminAuth, async (req, res) => {
  if (!isPrimarySuperAdmin(req.admin)) {
    return res.status(403).json({
      success: false,
      message: "Only Albert Baiyekusi can manage other admins.",
    });
  }

  const targetId = Number(req.params.id);
  if (!targetId) {
    return res.status(400).json({
      success: false,
      message: "Valid admin id is required.",
    });
  }

  try {
    await ensureAdminTableReady();
    const connection = await getConnection();
    const tableName = getAdminTableName();
    try {
      const [result] = await connection.execute(
        `DELETE FROM ${tableName}
         WHERE id = ?
           AND LOWER(username) <> LOWER(?)`,
        [targetId, PRIMARY_SUPER_ADMIN_USERNAME],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Admin not found.",
        });
      }

      return res.json({
        success: true,
        message: "Admin deleted successfully.",
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Delete admin error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete admin right now.",
    });
  }
});

router.patch("/password", requireAdminAuth, async (req, res) => {
  const adminId = req.admin?.sub;
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Current password and new password are required.",
    });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 6 characters long.",
    });
  }

  try {
    const admin = await getAdminById(adminId);
    if (!admin || admin.is_active === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin account not found.",
      });
    }

    const currentMatches = await bcrypt.compare(
      String(currentPassword),
      admin.password_hash || "",
    );

    if (!currentMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    const connection = await getConnection();
    const tableName = getAdminTableName();
    try {
      await connection.execute(
        `UPDATE ${tableName}
         SET password_hash = ?
         WHERE id = ?`,
        [newHash, admin.id],
      );
    } finally {
      await connection.end();
    }

    return res.json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update password right now.",
    });
  }
});

export default router;
