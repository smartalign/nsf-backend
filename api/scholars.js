import express from "express";
import { getConnection } from "./db.js";
import { requireAdminAuth } from "./authMiddleware.js";

const router = express.Router();
const DEFAULT_SCHOLARS_TABLE = "scholars";
let scholarsTableReadyPromise = null;

const getScholarsTableName = () => {
  const configuredTable = process.env.SCHOLARS_TABLE || DEFAULT_SCHOLARS_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_SCHOLARS_TABLE;
};

const parseProfessions = (rawValue) => {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

const mapScholarRow = (row) => ({
  id: row.id,
  name: row.name,
  gender: row.gender || undefined,
  country: row.country,
  field: row.field_name,
  description: row.description,
  bio: row.bio,
  professions: parseProfessions(row.professions_json),
  image: row.image,
  imagePosition: row.image_position || undefined,
  twitter: row.twitter || undefined,
  linkedin: row.linkedin || undefined,
  isExecutive: Boolean(row.is_executive),
  executiveRoleKey: row.executive_role_key || undefined,
  executiveRole: row.executive_role || undefined,
  executiveResponsibilities: row.executive_responsibilities || undefined,
});

const ensureScholarsTableReady = async () => {
  if (!scholarsTableReadyPromise) {
    scholarsTableReadyPromise = (async () => {
      const connection = await getConnection();
      const tableName = getScholarsTableName();

      try {
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
            id VARCHAR(191) NOT NULL,
            name VARCHAR(180) NOT NULL,
            gender ENUM('male', 'female') NULL,
            country VARCHAR(150) NOT NULL,
            field_name VARCHAR(180) NOT NULL,
            description TEXT NOT NULL,
            bio TEXT NOT NULL,
            professions_json LONGTEXT NOT NULL,
            image LONGTEXT NOT NULL,
            image_position VARCHAR(100) NULL,
            twitter VARCHAR(255) NULL,
            linkedin VARCHAR(255) NULL,
            is_executive TINYINT(1) NOT NULL DEFAULT 0,
            executive_role_key VARCHAR(120) NULL,
            executive_role VARCHAR(255) NULL,
            executive_responsibilities TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      } finally {
        await connection.end();
      }
    })().catch((error) => {
      scholarsTableReadyPromise = null;
      throw error;
    });
  }

  return scholarsTableReadyPromise;
};

const normalizeScholarPayload = (payload) => {
  const id = String(payload.id || "").trim();
  const name = String(payload.name || "").trim();
  const genderRaw = String(payload.gender || "").trim().toLowerCase();
  const gender = genderRaw === "male" || genderRaw === "female" ? genderRaw : null;
  const country = String(payload.country || "").trim();
  const fieldName = String(payload.field || "").trim();
  const description = String(payload.description || "").trim();
  const bio = String(payload.bio || description || "").trim();
  const image = String(payload.image || "").trim();
  const imagePosition = String(payload.imagePosition || "").trim() || null;
  const twitter = String(payload.twitter || "").trim() || null;
  const linkedin = String(payload.linkedin || "").trim() || null;
  const executiveRoleKey =
    String(payload.executiveRoleKey || "").trim() || null;
  const executiveRole = String(payload.executiveRole || "").trim() || null;
  const executiveResponsibilities =
    String(payload.executiveResponsibilities || "").trim() || null;
  const isExecutive = Boolean(payload.isExecutive);
  const professions = Array.isArray(payload.professions)
    ? payload.professions.map((entry) => String(entry).trim()).filter(Boolean)
    : [];

  return {
    id,
    name,
    gender,
    country,
    fieldName,
    description,
    bio,
    professions,
    image,
    imagePosition,
    twitter,
    linkedin,
    isExecutive,
    executiveRoleKey,
    executiveRole,
    executiveResponsibilities,
  };
};

const validateScholarPayload = (scholar) => {
  if (!scholar.id) return "Scholar id is required.";
  if (!scholar.name) return "Scholar name is required.";
  if (!scholar.country) return "Scholar country is required.";
  if (!scholar.fieldName) return "Scholar field is required.";
  if (!scholar.description) return "Scholar description is required.";
  if (!scholar.bio) return "Scholar bio is required.";
  if (scholar.professions.length === 0)
    return "At least one profession is required.";
  if (!scholar.image) return "Scholar image is required.";
  return null;
};

router.get("/", async (req, res) => {
  try {
    await ensureScholarsTableReady();
    const connection = await getConnection();
    const tableName = getScholarsTableName();

    try {
      const [rows] = await connection.execute(
        `SELECT id, name, gender, country, field_name, description, bio, professions_json,
                image, image_position, twitter, linkedin, is_executive,
                executive_role_key, executive_role, executive_responsibilities
         FROM ${tableName}
         ORDER BY created_at DESC`,
      );

      return res.json({
        success: true,
        scholars: rows.map(mapScholarRow),
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Get scholars error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch scholars right now.",
    });
  }
});

router.post("/", requireAdminAuth, async (req, res) => {
  try {
    await ensureScholarsTableReady();
    const scholar = normalizeScholarPayload(req.body || {});
    const validationMessage = validateScholarPayload(scholar);
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const connection = await getConnection();
    const tableName = getScholarsTableName();

    try {
      await connection.execute(
        `INSERT INTO ${tableName} (
          id, name, gender, country, field_name, description, bio, professions_json,
          image, image_position, twitter, linkedin, is_executive,
          executive_role_key, executive_role, executive_responsibilities
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scholar.id,
          scholar.name,
          scholar.gender,
          scholar.country,
          scholar.fieldName,
          scholar.description,
          scholar.bio,
          JSON.stringify(scholar.professions),
          scholar.image,
          scholar.imagePosition,
          scholar.twitter,
          scholar.linkedin,
          scholar.isExecutive ? 1 : 0,
          scholar.isExecutive ? scholar.executiveRoleKey : null,
          scholar.isExecutive ? scholar.executiveRole : null,
          scholar.isExecutive ? scholar.executiveResponsibilities : null,
        ],
      );

      return res.status(201).json({
        success: true,
        scholar: {
          id: scholar.id,
          name: scholar.name,
          gender: scholar.gender || undefined,
          country: scholar.country,
          field: scholar.fieldName,
          description: scholar.description,
          bio: scholar.bio,
          professions: scholar.professions,
          image: scholar.image,
          imagePosition: scholar.imagePosition || undefined,
          twitter: scholar.twitter || undefined,
          linkedin: scholar.linkedin || undefined,
          isExecutive: scholar.isExecutive,
          executiveRoleKey: scholar.executiveRoleKey || undefined,
          executiveRole: scholar.executiveRole || undefined,
          executiveResponsibilities:
            scholar.executiveResponsibilities || undefined,
        },
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A scholar with this id already exists.",
      });
    }

    console.error("Create scholar error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create scholar right now.",
    });
  }
});

router.put("/:id", requireAdminAuth, async (req, res) => {
  try {
    await ensureScholarsTableReady();
    const routeId = String(req.params.id || "").trim();
    const scholar = normalizeScholarPayload({
      ...req.body,
      id: routeId,
    });
    const validationMessage = validateScholarPayload(scholar);
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const connection = await getConnection();
    const tableName = getScholarsTableName();
    try {
      const [result] = await connection.execute(
        `UPDATE ${tableName}
         SET name = ?, gender = ?, country = ?, field_name = ?, description = ?,
             bio = ?, professions_json = ?, image = ?, image_position = ?,
             twitter = ?, linkedin = ?, is_executive = ?, executive_role_key = ?,
             executive_role = ?, executive_responsibilities = ?
         WHERE id = ?`,
        [
          scholar.name,
          scholar.gender,
          scholar.country,
          scholar.fieldName,
          scholar.description,
          scholar.bio,
          JSON.stringify(scholar.professions),
          scholar.image,
          scholar.imagePosition,
          scholar.twitter,
          scholar.linkedin,
          scholar.isExecutive ? 1 : 0,
          scholar.isExecutive ? scholar.executiveRoleKey : null,
          scholar.isExecutive ? scholar.executiveRole : null,
          scholar.isExecutive ? scholar.executiveResponsibilities : null,
          routeId,
        ],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Scholar not found.",
        });
      }

      return res.json({
        success: true,
        scholar: {
          id: scholar.id,
          name: scholar.name,
          gender: scholar.gender || undefined,
          country: scholar.country,
          field: scholar.fieldName,
          description: scholar.description,
          bio: scholar.bio,
          professions: scholar.professions,
          image: scholar.image,
          imagePosition: scholar.imagePosition || undefined,
          twitter: scholar.twitter || undefined,
          linkedin: scholar.linkedin || undefined,
          isExecutive: scholar.isExecutive,
          executiveRoleKey: scholar.executiveRoleKey || undefined,
          executiveRole: scholar.executiveRole || undefined,
          executiveResponsibilities:
            scholar.executiveResponsibilities || undefined,
        },
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Update scholar error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update scholar right now.",
    });
  }
});

router.delete("/:id", requireAdminAuth, async (req, res) => {
  try {
    await ensureScholarsTableReady();
    const routeId = String(req.params.id || "").trim();
    const connection = await getConnection();
    const tableName = getScholarsTableName();
    try {
      const [result] = await connection.execute(
        `DELETE FROM ${tableName} WHERE id = ?`,
        [routeId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Scholar not found.",
        });
      }

      return res.json({
        success: true,
        message: "Scholar deleted successfully.",
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Delete scholar error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete scholar right now.",
    });
  }
});

export default router;
