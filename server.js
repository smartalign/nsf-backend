import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./api/auth.js";
import scholarsRoutes from "./api/scholars.js";
import eventsRoutes from "./api/events.js";
import blogsRoutes from "./api/blogs.js";
import contactRoutes from "./api/contact.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/api/auth", authRoutes);
app.use("/api/scholars", scholarsRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/blogs", blogsRoutes);
app.use("/api/contact", contactRoutes);

app.get("/", (req, res) => {
  res.send("API is running now");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
