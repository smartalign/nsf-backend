import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_EVENTS_TABLE = "events";

const getEventsTableName = () => {
  const configuredTable = process.env.EVENTS_TABLE || DEFAULT_EVENTS_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_EVENTS_TABLE;
};

const extractEventsArray = (source) => {
  const marker = "export const events: EventItem[] = [";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error("Could not find events array in events.ts");
  }

  const equalsIndex = source.indexOf("=", start);
  const openBracket = source.indexOf("[", equalsIndex);
  if (openBracket < 0) {
    throw new Error("Could not parse opening bracket for events array");
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
    throw new Error("Could not parse closing bracket for events array");
  }

  return source.slice(openBracket, end + 1);
};

const parseSourceEvents = async () => {
  const sourcePath = path.resolve(__dirname, "../../nsf/src/data/events.ts");
  const source = await fs.readFile(sourcePath, "utf8");
  const eventsArrayLiteral = extractEventsArray(source);

  const parseFn = new Function(`
    const janProgramPoster = "Noble Scholar Foundation Design( 2nd January)-2.jpg.jpeg";
    const valentineProgramPoster = "Valentine Bi Weekly Design.jpg.jpeg";
    const events = ${eventsArrayLiteral};
    return { events };
  `);

  const { events } = parseFn();
  return Array.isArray(events) ? events : [];
};

const ensureEventsTable = async (connection, tableName) => {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id VARCHAR(191) NOT NULL,
      title VARCHAR(255) NOT NULL,
      summary TEXT NOT NULL,
      date_label VARCHAR(120) NOT NULL,
      time_label VARCHAR(120) NOT NULL,
      location_label VARCHAR(255) NOT NULL,
      theme VARCHAR(255) NOT NULL,
      speaker VARCHAR(255) NULL,
      status ENUM('Completed', 'Ongoing') NOT NULL DEFAULT 'Completed',
      image LONGTEXT NOT NULL,
      details_html LONGTEXT NOT NULL,
      attendees_json LONGTEXT NULL,
      guests_json LONGTEXT NULL,
      report_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const seedEvents = async () => {
  const events = await parseSourceEvents();
  const tableName = getEventsTableName();

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "nsf",
    port: Number(process.env.MYSQL_PORT || 3306),
  });

  try {
    await ensureEventsTable(connection, tableName);
    await connection.beginTransaction();

    const upsertSql = `
      INSERT INTO ${tableName} (
        id, title, summary, date_label, time_label, location_label, theme,
        speaker, status, image, details_html, attendees_json, guests_json, report_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        summary = VALUES(summary),
        date_label = VALUES(date_label),
        time_label = VALUES(time_label),
        location_label = VALUES(location_label),
        theme = VALUES(theme),
        speaker = VALUES(speaker),
        status = VALUES(status),
        image = VALUES(image),
        details_html = VALUES(details_html),
        attendees_json = VALUES(attendees_json),
        guests_json = VALUES(guests_json),
        report_json = VALUES(report_json)
    `;

    for (const event of events) {
      const attendees = Array.isArray(event.attendees) ? event.attendees : [];
      const guests = Array.isArray(event.guests) ? event.guests : [];

      await connection.execute(upsertSql, [
        String(event.id || "").trim(),
        String(event.title || "").trim(),
        String(event.summary || "").trim(),
        String(event.date || "").trim(),
        String(event.time || "").trim(),
        String(event.location || "").trim(),
        String(event.theme || "").trim(),
        event.speaker ? String(event.speaker).trim() : null,
        event.status === "Ongoing" ? "Ongoing" : "Completed",
        String(event.image || "").trim(),
        String(event.details || "").trim(),
        JSON.stringify(attendees),
        JSON.stringify(guests),
        JSON.stringify(event.report || null),
      ]);
    }

    await connection.commit();
    console.log(`Seed complete: ${events.length} event records upserted into '${tableName}'.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
};

seedEvents().catch((error) => {
  console.error("Event seed failed:", error);
  process.exit(1);
});
