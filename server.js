require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3001;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "ig_bot";
const DASHBOARD_PW = process.env.DASHBOARD_PASSWORD || "admin0987";
const JWT_SECRET = process.env.JWT_SECRET || "velox-ig-dashboard-2026-secret";

app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── DB ───────────────────────────────────────────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  db = client.db(MONGODB_DB);
  console.log(`[DB] Connected → ${MONGODB_DB}`);
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== DASHBOARD_PW)
    return res.status(401).json({ error: "Invalid password" });
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

// ─── GET /api/config ──────────────────────────────────────────────────────────
app.get("/api/config", requireAuth, async (_req, res) => {
  const doc = await db.collection("bot_config").findOne({ key: "messages" });
  const defaults = {
    greeting:
      "Hey {name}! Thanks for following us. We are here if you ever need anything!",
    followup_1:
      "Hey {name}! Just checking in — let us know if you have any questions. Happy to help!",
    followup_2:
      "Hi {name}! Still here if you need anything from us. Don't hesitate to reach out!",
    followup_3:
      "Hey {name}! Last check-in from our side — feel free to message us anytime you are ready!",
  };
  if (!doc) return res.json(defaults);
  const { _id, key, ...rest } = doc;
  res.json({ ...defaults, ...rest });
});

// ─── PUT /api/config ──────────────────────────────────────────────────────────
app.put("/api/config", requireAuth, async (req, res) => {
  const { greeting, followup_1, followup_2, followup_3 } = req.body || {};
  if (!greeting) return res.status(400).json({ error: "greeting is required" });
  await db
    .collection("bot_config")
    .updateOne(
      { key: "messages" },
      {
        $set: {
          key: "messages",
          greeting,
          followup_1,
          followup_2,
          followup_3,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  res.json({ ok: true });
});

// ─── GET /api/analytics/overview ─────────────────────────────────────────────
app.get("/api/analytics/overview", requireAuth, async (_req, res) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13).replace("T", " ");
  const week = new Date(now - 7 * 86_400_000);

  const [total, todayDoc, hourDoc, thisWeek, replied] = await Promise.all([
    db.collection("messaged_users").countDocuments(),
    db.collection("daily_counts").findOne({ date: today }),
    db.collection("hourly_counts").findOne({ hour }),
    db.collection("messaged_users").countDocuments({ sent_at: { $gte: week } }),
    db.collection("messaged_users").countDocuments({ replied: true }),
  ]);

  res.json({
    total,
    today: todayDoc?.count || 0,
    thisHour: hourDoc?.count || 0,
    thisWeek,
    replyRate: total > 0 ? +((replied / total) * 100).toFixed(1) : 0,
    replied,
  });
});

// ─── GET /api/analytics/daily ─────────────────────────────────────────────────
app.get("/api/analytics/daily", requireAuth, async (_req, res) => {
  const docs = await db
    .collection("daily_counts")
    .find()
    .sort({ date: 1 })
    .limit(30)
    .toArray();
  res.json(docs.map((d) => ({ date: d.date.slice(5), dms: d.count })));
});

// ─── GET /api/analytics/hourly ────────────────────────────────────────────────
app.get("/api/analytics/hourly", requireAuth, async (_req, res) => {
  const docs = await db
    .collection("hourly_counts")
    .find()
    .sort({ hour: -1 })
    .limit(24)
    .toArray();
  docs.reverse();
  res.json(docs.map((d) => ({ hour: d.hour.slice(11) + ":00", dms: d.count })));
});

// ─── GET /api/analytics/recent ────────────────────────────────────────────────
app.get("/api/analytics/recent", requireAuth, async (_req, res) => {
  const docs = await db
    .collection("messaged_users")
    .find()
    .sort({ sent_at: -1 })
    .limit(30)
    .toArray();
  res.json(
    docs.map((d) => ({
      username: d.username,
      trigger: d.trigger,
      sent_at: d.sent_at,
      replied: !!d.replied,
      followups_sent: d.followups_sent || 0,
    })),
  );
});

// ─── Start ────────────────────────────────────────────────────────────────────
connectDB()
  .then(() =>
    app.listen(PORT, () => console.log(`🚀 Dashboard API on :${PORT}`)),
  )
  .catch((err) => {
    console.error("DB connection failed:", err);
    process.exit(1);
  });
