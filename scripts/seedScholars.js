import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SCHOLARS_TABLE = "scholars";

const getScholarsTableName = () => {
  const configuredTable = process.env.SCHOLARS_TABLE || DEFAULT_SCHOLARS_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_SCHOLARS_TABLE;
};

const extractConstBlock = (source, constName) => {
  const marker = `const ${constName}`;
  const exportMarker = `export const ${constName}`;
  const start = source.indexOf(marker) >= 0
    ? source.indexOf(marker)
    : source.indexOf(exportMarker);

  if (start < 0) {
    throw new Error(`Could not find ${constName} in scholars.ts`);
  }

  const openBrace = source.indexOf("{", start);
  if (openBrace < 0) {
    throw new Error(`Could not parse opening brace for ${constName}`);
  }

  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }

  if (end < 0) {
    throw new Error(`Could not parse closing brace for ${constName}`);
  }

  return source.slice(openBrace, end + 1);
};

const extractScholarsArray = (source) => {
  const marker = "export const scholars: Scholar[] = [";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error("Could not find scholars array in scholars.ts");
  }

  const equalsIndex = source.indexOf("=", start);
  const openBracket = source.indexOf("[", equalsIndex);
  if (openBracket < 0) {
    throw new Error("Could not parse opening bracket for scholars array");
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
    throw new Error("Could not parse closing bracket for scholars array");
  }

  return source.slice(openBracket, end + 1);
};

const parseSourceScholars = async () => {
  const sourcePath = path.resolve(__dirname, "../../nsf/src/data/scholars.ts");
  const source = await fs.readFile(sourcePath, "utf8");

  const scholarsArrayLiteral = extractScholarsArray(source);
  const roleCatalogLiteral = extractConstBlock(source, "EXECUTIVE_ROLE_CATALOG");
  const defaultAssignmentsLiteral = extractConstBlock(
    source,
    "DEFAULT_EXECUTIVE_ASSIGNMENTS",
  );

  const parseFn = new Function(`
    const maleScholarIcon = "male icon.jpg";
    const femaleScholarIcon = "female icon.jpg";
    const founderImage = "founder image.jpeg";
    const EXECUTIVE_ROLE_CATALOG = ${roleCatalogLiteral};
    const DEFAULT_EXECUTIVE_ASSIGNMENTS = ${defaultAssignmentsLiteral};
    const scholars = ${scholarsArrayLiteral};
    return { scholars, EXECUTIVE_ROLE_CATALOG, DEFAULT_EXECUTIVE_ASSIGNMENTS };
  `);

  const { scholars, EXECUTIVE_ROLE_CATALOG, DEFAULT_EXECUTIVE_ASSIGNMENTS } =
    parseFn();

  return scholars.map((item) => {
    const assignedRoleKey =
      item.executiveRoleKey ?? DEFAULT_EXECUTIVE_ASSIGNMENTS[item.id];
    const roleMeta = assignedRoleKey
      ? EXECUTIVE_ROLE_CATALOG[assignedRoleKey]
      : null;

    return {
      ...item,
      isExecutive: Boolean(item.isExecutive || assignedRoleKey),
      executiveRoleKey: assignedRoleKey || null,
      executiveRole: item.executiveRole ?? roleMeta?.role ?? null,
      executiveResponsibilities:
        item.executiveResponsibilities ?? roleMeta?.responsibilities ?? null,
    };
  });
};

const ensureScholarsTable = async (connection, tableName) => {
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
};

const seedScholars = async () => {
  const scholars = await parseSourceScholars();
  const tableName = getScholarsTableName();

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "nsf",
    port: Number(process.env.MYSQL_PORT || 3306),
  });

  try {
    await ensureScholarsTable(connection, tableName);
    await connection.beginTransaction();

    const upsertSql = `
      INSERT INTO ${tableName} (
        id, name, gender, country, field_name, description, bio, professions_json,
        image, image_position, twitter, linkedin, is_executive,
        executive_role_key, executive_role, executive_responsibilities
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        gender = VALUES(gender),
        country = VALUES(country),
        field_name = VALUES(field_name),
        description = VALUES(description),
        bio = VALUES(bio),
        professions_json = VALUES(professions_json),
        image = VALUES(image),
        image_position = VALUES(image_position),
        twitter = VALUES(twitter),
        linkedin = VALUES(linkedin),
        is_executive = VALUES(is_executive),
        executive_role_key = VALUES(executive_role_key),
        executive_role = VALUES(executive_role),
        executive_responsibilities = VALUES(executive_responsibilities)
    `;

    for (const scholar of scholars) {
      await connection.execute(upsertSql, [
        scholar.id,
        scholar.name,
        scholar.gender || null,
        scholar.country,
        scholar.field,
        scholar.description,
        scholar.bio || scholar.description,
        JSON.stringify(Array.isArray(scholar.professions) ? scholar.professions : []),
        scholar.image || "",
        scholar.imagePosition || null,
        scholar.twitter || null,
        scholar.linkedin || null,
        scholar.isExecutive ? 1 : 0,
        scholar.isExecutive ? scholar.executiveRoleKey || null : null,
        scholar.isExecutive ? scholar.executiveRole || null : null,
        scholar.isExecutive ? scholar.executiveResponsibilities || null : null,
      ]);
    }

    await connection.commit();
    console.log(
      `Seed complete: ${scholars.length} scholar records upserted into '${tableName}'.`,
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
};

seedScholars().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
