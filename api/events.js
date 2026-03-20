import express from "express";
import { getConnection } from "./db.js";
import { requireAdminAuth } from "./authMiddleware.js";

const router = express.Router();
const DEFAULT_EVENTS_TABLE = "events";
let eventsTableReadyPromise = null;

const getEventsTableName = () => {
  const configuredTable = process.env.EVENTS_TABLE || DEFAULT_EVENTS_TABLE;
  return /^[a-zA-Z0-9_]+$/.test(configuredTable)
    ? configuredTable
    : DEFAULT_EVENTS_TABLE;
};

const parseJsonArray = (rawValue) => {
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

const parseJsonObject = (rawValue) => {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeStringArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];

const buildFallbackReport = (event) => {
  const attendees = normalizeStringArray(event.attendees);
  const guests = normalizeStringArray(event.guests);
  const hasAttendance = attendees.length > 0 || guests.length > 0;

  return {
    dateLabel: event.date,
    timeLabel: event.time,
    locationLabel: event.location,
    speakerLabel: event.speaker || undefined,
    attendees: hasAttendance
      ? {
          scholars: attendees,
          guests,
        }
      : undefined,
  };
};

const normalizeEventPayload = (payload) => {
  const id = String(payload.id || "").trim();
  const title = String(payload.title || "").trim();
  const summary = String(payload.summary || "").trim();
  const date = String(payload.date || "").trim();
  const time = String(payload.time || "").trim();
  const location = String(payload.location || "").trim();
  const theme = String(payload.theme || "").trim();
  const speaker = String(payload.speaker || "").trim() || undefined;
  const statusValue = String(payload.status || "").trim();
  const status = statusValue === "Ongoing" ? "Ongoing" : "Completed";
  const image = String(payload.image || "").trim();
  const details = String(payload.details || "").trim();
  const attendees = normalizeStringArray(payload.attendees);
  const guests = normalizeStringArray(payload.guests);
  const report =
    payload.report && typeof payload.report === "object"
      ? payload.report
      : buildFallbackReport({
          date,
          time,
          location,
          speaker,
          attendees,
          guests,
        });

  return {
    id,
    title,
    summary,
    date,
    time,
    location,
    theme,
    speaker,
    attendees,
    guests,
    status,
    image,
    details,
    report,
  };
};

const validateEventPayload = (event) => {
  if (!event.id) return "Event id is required.";
  if (!event.title) return "Event title is required.";
  if (!event.summary) return "Event summary is required.";
  if (!event.date) return "Event date is required.";
  if (!event.time) return "Event time is required.";
  if (!event.location) return "Event location is required.";
  if (!event.theme) return "Event theme is required.";
  if (!event.image) return "Event image is required.";
  if (!event.details) return "Event details are required.";
  return null;
};

const mapEventRow = (row) => {
  const attendees = parseJsonArray(row.attendees_json);
  const guests = parseJsonArray(row.guests_json);
  const report = parseJsonObject(row.report_json) || {
    dateLabel: row.date_label,
    timeLabel: row.time_label,
    locationLabel: row.location_label,
    speakerLabel: row.speaker || undefined,
    attendees:
      attendees.length > 0 || guests.length > 0
        ? {
            scholars: attendees,
            guests,
          }
        : undefined,
  };

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    date: row.date_label,
    time: row.time_label,
    location: row.location_label,
    theme: row.theme,
    speaker: row.speaker || undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
    guests: guests.length > 0 ? guests : undefined,
    status: row.status,
    image: row.image,
    details: row.details_html,
    report,
  };
};

const ensureEventsTableReady = async () => {
  if (!eventsTableReadyPromise) {
    eventsTableReadyPromise = (async () => {
      const connection = await getConnection();
      const tableName = getEventsTableName();

      try {
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
      } finally {
        await connection.end();
      }
    })().catch((error) => {
      eventsTableReadyPromise = null;
      throw error;
    });
  }

  return eventsTableReadyPromise;
};

router.get("/", async (req, res) => {
  try {
    await ensureEventsTableReady();
    const connection = await getConnection();
    const tableName = getEventsTableName();

    try {
      const [rows] = await connection.execute(
        `SELECT id, title, summary, date_label, time_label, location_label, theme,
                speaker, status, image, details_html, attendees_json, guests_json, report_json
         FROM ${tableName}
         ORDER BY created_at DESC`,
      );

      return res.json({
        success: true,
        events: rows.map(mapEventRow),
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Get events error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch events right now.",
    });
  }
});

router.post("/", requireAdminAuth, async (req, res) => {
  try {
    await ensureEventsTableReady();
    const event = normalizeEventPayload(req.body || {});
    const validationMessage = validateEventPayload(event);
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const connection = await getConnection();
    const tableName = getEventsTableName();
    try {
      await connection.execute(
        `INSERT INTO ${tableName} (
          id, title, summary, date_label, time_label, location_label, theme,
          speaker, status, image, details_html, attendees_json, guests_json, report_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.title,
          event.summary,
          event.date,
          event.time,
          event.location,
          event.theme,
          event.speaker || null,
          event.status,
          event.image,
          event.details,
          JSON.stringify(event.attendees),
          JSON.stringify(event.guests),
          JSON.stringify(event.report),
        ],
      );

      return res.status(201).json({
        success: true,
        event,
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An event with this id already exists.",
      });
    }

    console.error("Create event error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create event right now.",
    });
  }
});

router.put("/:id", requireAdminAuth, async (req, res) => {
  try {
    await ensureEventsTableReady();
    const routeId = String(req.params.id || "").trim();
    const event = normalizeEventPayload({
      ...req.body,
      id: routeId,
    });
    const validationMessage = validateEventPayload(event);
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const connection = await getConnection();
    const tableName = getEventsTableName();
    try {
      const [result] = await connection.execute(
        `UPDATE ${tableName}
         SET title = ?, summary = ?, date_label = ?, time_label = ?, location_label = ?,
             theme = ?, speaker = ?, status = ?, image = ?, details_html = ?,
             attendees_json = ?, guests_json = ?, report_json = ?
         WHERE id = ?`,
        [
          event.title,
          event.summary,
          event.date,
          event.time,
          event.location,
          event.theme,
          event.speaker || null,
          event.status,
          event.image,
          event.details,
          JSON.stringify(event.attendees),
          JSON.stringify(event.guests),
          JSON.stringify(event.report),
          routeId,
        ],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      return res.json({
        success: true,
        event,
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Update event error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update event right now.",
    });
  }
});

router.delete("/:id", requireAdminAuth, async (req, res) => {
  try {
    await ensureEventsTableReady();
    const routeId = String(req.params.id || "").trim();
    const connection = await getConnection();
    const tableName = getEventsTableName();
    try {
      const [result] = await connection.execute(
        `DELETE FROM ${tableName} WHERE id = ?`,
        [routeId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      return res.json({
        success: true,
        message: "Event deleted successfully.",
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Delete event error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete event right now.",
    });
  }
});

export default router;
