import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_BLOGS_TABLE = "blogs";

const getBlogsTableName = () => {
  const configuredTable = process.env.BLOGS_TABLE || DEFAULT_BLOGS_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_BLOGS_TABLE;
};

const extractBlogsArray = (source) => {
  const marker = "export const blogPosts: BlogPostItem[] = [";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error("Could not find blogPosts array in blog.ts");
  }

  const equalsIndex = source.indexOf("=", start);
  const openBracket = source.indexOf("[", equalsIndex);
  if (openBracket < 0) {
    throw new Error("Could not parse opening bracket for blogPosts array");
  }

  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < source.length; i += 1) {
    const char = source[i];
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }

  if (end < 0) {
    throw new Error("Could not parse closing bracket for blogPosts array");
  }

  return source.slice(openBracket, end + 1);
};

const parseSourceBlogs = async () => {
  const sourcePath = path.resolve(__dirname, "../../nsf/src/data/blog.ts");
  const source = await fs.readFile(sourcePath, "utf8");
  const blogArrayLiteral = extractBlogsArray(source);

  const parseFn = new Function(`
    const blogPosts = ${blogArrayLiteral};
    return { blogPosts };
  `);

  const { blogPosts } = parseFn();
  return Array.isArray(blogPosts) ? blogPosts : [];
};

const ensureBlogsTable = async (connection, tableName) => {
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
};

const seedBlogs = async () => {
  const blogs = await parseSourceBlogs();
  const tableName = getBlogsTableName();

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "nsf",
    port: Number(process.env.MYSQL_PORT || 3306),
  });

  try {
    await ensureBlogsTable(connection, tableName);
    await connection.beginTransaction();

    const upsertSql = `
      INSERT INTO ${tableName} (
        id, title, excerpt, date_label, author, theme, content_html, content_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        excerpt = VALUES(excerpt),
        date_label = VALUES(date_label),
        author = VALUES(author),
        theme = VALUES(theme),
        content_html = VALUES(content_html),
        content_json = VALUES(content_json)
    `;

    for (const blog of blogs) {
      await connection.execute(upsertSql, [
        String(blog.id || "").trim(),
        String(blog.title || "").trim(),
        String(blog.excerpt || "").trim(),
        String(blog.date || "").trim(),
        String(blog.author || "").trim(),
        String(blog.theme || "").trim(),
        blog.contentHtml ? String(blog.contentHtml) : null,
        JSON.stringify(Array.isArray(blog.content) ? blog.content : []),
      ]);
    }

    await connection.commit();
    console.log(`Seed complete: ${blogs.length} blog records upserted into '${tableName}'.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
};

seedBlogs().catch((error) => {
  console.error("Blog seed failed:", error);
  process.exit(1);
});
