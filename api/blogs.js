import express from "express";
import { getConnection } from "./db.js";
import { requireAdminAuth } from "./authMiddleware.js";

const router = express.Router();
const DEFAULT_BLOGS_TABLE = "blogs";
let blogsTableReadyPromise = null;

const getBlogsTableName = () => {
  const configuredTable = process.env.BLOGS_TABLE || DEFAULT_BLOGS_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_BLOGS_TABLE;
};

const parseContent = (rawValue) => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeBlogPayload = (payload) => {
  const id = String(payload.id || "").trim();
  const title = String(payload.title || "").trim();
  const excerpt = String(payload.excerpt || "").trim();
  const date = String(payload.date || "").trim();
  const author = String(payload.author || "").trim();
  const theme = String(payload.theme || "").trim();
  const contentHtml = payload.contentHtml
    ? String(payload.contentHtml).trim()
    : undefined;
  const content = Array.isArray(payload.content) ? payload.content : [];

  return {
    id,
    title,
    excerpt,
    date,
    author,
    theme,
    contentHtml,
    content,
  };
};

const validateBlogPayload = (blog) => {
  if (!blog.id) return "Blog id is required.";
  if (!blog.title) return "Blog title is required.";
  if (!blog.excerpt) return "Blog excerpt is required.";
  if (!blog.date) return "Blog date is required.";
  if (!blog.author) return "Blog author is required.";
  if (!blog.theme) return "Blog theme is required.";
  if (!blog.contentHtml && (!Array.isArray(blog.content) || blog.content.length === 0)) {
    return "Blog content is required.";
  }
  return null;
};

const mapBlogRow = (row) => ({
  id: row.id,
  title: row.title,
  excerpt: row.excerpt,
  date: row.date_label,
  author: row.author,
  theme: row.theme,
  contentHtml: row.content_html || undefined,
  content: parseContent(row.content_json),
});

const ensureBlogsTableReady = async () => {
  if (!blogsTableReadyPromise) {
    blogsTableReadyPromise = (async () => {
      const connection = await getConnection();
      const tableName = getBlogsTableName();

      try {
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS ${tableName} (
            id VARCHAR(191) NOT NULL,
            title VARCHAR(255) NOT NULL,
            excerpt TEXT NOT NULL,
            date_label VARCHAR(120) NOT NULL,
            author VARCHAR(255) NOT NULL,
            theme VARCHAR(255) NOT NULL,
            content_html LONGTEXT NULL,
            content_json LONGTEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      } finally {
        await connection.end();
      }
    })().catch((error) => {
      blogsTableReadyPromise = null;
      throw error;
    });
  }

  return blogsTableReadyPromise;
};

router.get("/", async (req, res) => {
  try {
    await ensureBlogsTableReady();
    const connection = await getConnection();
    const tableName = getBlogsTableName();
    try {
      const [rows] = await connection.execute(
        `SELECT id, title, excerpt, date_label, author, theme, content_html, content_json
         FROM ${tableName}
         ORDER BY created_at DESC`,
      );

      return res.json({
        success: true,
        blogs: rows.map(mapBlogRow),
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Get blogs error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch blogs right now.",
    });
  }
});

router.post("/", requireAdminAuth, async (req, res) => {
  try {
    await ensureBlogsTableReady();
    const blog = normalizeBlogPayload(req.body || {});
    const validationMessage = validateBlogPayload(blog);
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const connection = await getConnection();
    const tableName = getBlogsTableName();
    try {
      await connection.execute(
        `INSERT INTO ${tableName} (
          id, title, excerpt, date_label, author, theme, content_html, content_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          blog.id,
          blog.title,
          blog.excerpt,
          blog.date,
          blog.author,
          blog.theme,
          blog.contentHtml || null,
          JSON.stringify(blog.content),
        ],
      );

      return res.status(201).json({
        success: true,
        blog,
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A blog with this id already exists.",
      });
    }
    console.error("Create blog error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create blog right now.",
    });
  }
});

router.put("/:id", requireAdminAuth, async (req, res) => {
  try {
    await ensureBlogsTableReady();
    const routeId = String(req.params.id || "").trim();
    const blog = normalizeBlogPayload({
      ...req.body,
      id: routeId,
    });
    const validationMessage = validateBlogPayload(blog);
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const connection = await getConnection();
    const tableName = getBlogsTableName();
    try {
      const [result] = await connection.execute(
        `UPDATE ${tableName}
         SET title = ?, excerpt = ?, date_label = ?, author = ?, theme = ?,
             content_html = ?, content_json = ?
         WHERE id = ?`,
        [
          blog.title,
          blog.excerpt,
          blog.date,
          blog.author,
          blog.theme,
          blog.contentHtml || null,
          JSON.stringify(blog.content),
          routeId,
        ],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Blog not found.",
        });
      }

      return res.json({
        success: true,
        blog,
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Update blog error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update blog right now.",
    });
  }
});

router.delete("/:id", requireAdminAuth, async (req, res) => {
  try {
    await ensureBlogsTableReady();
    const routeId = String(req.params.id || "").trim();
    const connection = await getConnection();
    const tableName = getBlogsTableName();
    try {
      const [result] = await connection.execute(
        `DELETE FROM ${tableName} WHERE id = ?`,
        [routeId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Blog not found.",
        });
      }

      return res.json({
        success: true,
        message: "Blog deleted successfully.",
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Delete blog error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete blog right now.",
    });
  }
});

export default router;
