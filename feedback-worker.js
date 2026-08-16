import { FEEDBACK_TOPICS } from "./feedback-config.js";
import { DurableObject } from "cloudflare:workers";

const RECIPIENT = "info@vlsi-cad.com";
const SENDER = "feedback@vlsi-cad.com";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const VISIT_WINDOW_MS = 60 * 60 * 1000;
// Preserve the public totals from the retired Flag Counter when storage is first created.
const INITIAL_COUNTS = [
  ["IL", 15],
  ["US", 7]
];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function singleLine(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function multiLine(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function isEmail(value) {
  return !value || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254);
}

function summarize({ name, email, background, topic, page, message }) {
  return [
    "New VLSI Design Academy feedback",
    "",
    `Name: ${name}`,
    `E-mail: ${email || "Not provided"}`,
    `Background: ${background || "Not provided"}`,
    `Topic: ${topic}`,
    `Page: ${page}`,
    `Submitted: ${new Date().toISOString()}`,
    "",
    "Message:",
    message
  ].join("\n");
}

function detectedCountry(request) {
  const country = request.cf?.country || request.headers.get("CF-IPCountry") || "";
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

function clientIdentity(request) {
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0].trim();
  const address = request.headers.get("CF-Connecting-IP") || forwarded || "unknown";
  const agent = (request.headers.get("User-Agent") || "unknown").slice(0, 512);
  return `${address}:${agent}`;
}

async function visitorKey(salt, identity, country) {
  const bytes = new TextEncoder().encode(`${salt}:${identity}:${country}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class VisitorCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS counter_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS countries (
        code TEXT PRIMARY KEY,
        visitors INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recent_visitors (
        visitor_key TEXT PRIMARY KEY,
        seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recent_visitors_seen_at
        ON recent_visitors(seen_at);
    `);

    const initialized = this.sql.exec(
      "SELECT value FROM counter_meta WHERE key = 'initialized'"
    ).toArray().length > 0;

    if (!initialized) {
      const now = Date.now();
      for (const [code, visitors] of INITIAL_COUNTS) {
        this.sql.exec(
          "INSERT INTO countries (code, visitors, first_seen, last_seen) VALUES (?, ?, ?, ?)",
          code,
          visitors,
          now,
          now
        );
      }
      this.sql.exec("INSERT INTO counter_meta (key, value) VALUES ('initialized', '1')");
    }

    const salt = this.sql.exec(
      "SELECT value FROM counter_meta WHERE key = 'visitor_salt'"
    ).toArray()[0]?.value;
    this.salt = salt || crypto.randomUUID();
    if (!salt) {
      this.sql.exec(
        "INSERT INTO counter_meta (key, value) VALUES ('visitor_salt', ?)",
        this.salt
      );
    }
  }

  async recordVisit(country, identity, now) {
    const key = await visitorKey(this.salt, identity, country);
    this.sql.exec("DELETE FROM recent_visitors WHERE seen_at < ?", now - VISIT_WINDOW_MS);
    this.sql.exec(
      "INSERT OR IGNORE INTO recent_visitors (visitor_key, seen_at) VALUES (?, ?)",
      key,
      now
    );
    const isNewVisit = this.sql.exec("SELECT changes() AS count").one().count === 1;

    if (isNewVisit) {
      this.sql.exec(`
        INSERT INTO countries (code, visitors, first_seen, last_seen)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          visitors = visitors + 1,
          last_seen = excluded.last_seen
      `, country, now, now);
    }

    const countries = this.sql.exec(`
      SELECT code, visitors AS count
      FROM countries
      ORDER BY visitors DESC, first_seen ASC
      LIMIT 10
    `).toArray();
    const total = this.sql.exec("SELECT COALESCE(SUM(visitors), 0) AS total FROM countries").one().total;

    return { countries, total };
  }
}

async function handleVisitorCounter(request, env) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "GET" });
  }

  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === "cross-site") {
    return json({ ok: false, error: "Cross-origin requests are not allowed." }, 403);
  }

  const country = detectedCountry(request);
  if (!country) {
    return json({ ok: false, error: "Visitor country is unavailable." }, 503);
  }

  const id = env.VISITOR_COUNTER.idFromName("global");
  const counter = env.VISITOR_COUNTER.get(id);
  const result = await counter.recordVisit(country, clientIdentity(request), Date.now());
  return json({ ok: true, country, ...result });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/visitor-counter") {
      try {
        return await handleVisitorCounter(request, env);
      } catch (error) {
        console.error("Visitor counter failed", error?.message || "unknown");
        return json({ ok: false, error: "Visitor counter is temporarily unavailable." }, 503);
      }
    }

    if (url.pathname !== "/api/feedback") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
    }

    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return json({ ok: false, error: "Cross-origin submissions are not allowed." }, 403);
    }

    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ ok: false, error: "Expected a JSON request." }, 415);
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 12000) {
      return json({ ok: false, error: "Submission is too large." }, 413);
    }

    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 12000) return json({ ok: false, error: "Submission is too large." }, 413);
      payload = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "Invalid submission." }, 400);
    }

    if (singleLine(payload.website, 200)) {
      return json({ ok: true });
    }

    const startedAt = Number(payload.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < 1500 || Date.now() - startedAt > 86400000) {
      return json({ ok: false, error: "Please reload the form and try again." }, 400);
    }

    const page = singleLine(payload.page, 100);
    const topic = FEEDBACK_TOPICS[page];
    const name = singleLine(payload.name, 120);
    const email = singleLine(payload.email, 254);
    const background = multiLine(payload.background, 1000);
    const message = multiLine(payload.message, 4000);

    if (!topic || !name || !message || !isEmail(email)) {
      return json({ ok: false, error: "Please complete all required fields with valid information." }, 400);
    }

    const emailMessage = {
      to: RECIPIENT,
      from: { email: SENDER, name: "VLSI Academy Feedback" },
      subject: `[VLSI Academy Feedback] ${topic}`,
      text: summarize({ name, email, background, topic, page, message })
    };

    if (email) emailMessage.replyTo = { email, name };

    try {
      const result = await env.FEEDBACK_EMAIL.send(emailMessage);
      return json({ ok: true, messageId: result.messageId });
    } catch (error) {
      console.error("Feedback email failed", error?.code || "unknown");
      return json({ ok: false, error: "Feedback could not be sent right now. Please try again later." }, 503);
    }
  }
};
