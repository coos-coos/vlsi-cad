import { FEEDBACK_TOPICS } from "./feedback-config.js";
import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";

const RECIPIENT = "info@vlsi-cad.com";
const SMTP_HOST = "netsol-smtp-oxcs.hostingplatform.com";
const SMTP_PORT = 587;
const SMTP_USERNAME = "info@vlsi-cad.com";
const SMTP_TIMEOUT_MS = 15000;
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

const TEXT_ENCODER = new TextEncoder();

function withTimeout(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), SMTP_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function base64(value) {
  const bytes = TEXT_ENCODER.encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function wrappedBase64(value) {
  return base64(value).match(/.{1,76}/g)?.join("\r\n") || "";
}

function buildEmail({ name, email, background, topic, page, message }) {
  const headers = [
    `From: VLSI Academy Feedback <${SMTP_USERNAME}>`,
    `To: ${RECIPIENT}`,
    `Subject: [VLSI Academy Feedback] ${topic}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@vlsi-cad.com>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64"
  ];

  if (email && /^[\x21-\x7e]+$/.test(email)) {
    headers.splice(2, 0, `Reply-To: ${email}`);
  }

  const body = summarize({ name, email, background, topic, page, message });
  return `${headers.join("\r\n")}\r\n\r\n${wrappedBase64(body)}\r\n`;
}

class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.decoder = new TextDecoder();
    this.buffer = "";
  }

  async readResponse(expectedCode) {
    let responseCode = null;
    const lines = [];

    while (true) {
      let lineEnd = this.buffer.indexOf("\r\n");
      while (lineEnd >= 0) {
        const line = this.buffer.slice(0, lineEnd);
        this.buffer = this.buffer.slice(lineEnd + 2);
        const match = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!match) throw new Error("The SMTP server returned an invalid response.");

        const code = Number(match[1]);
        responseCode ??= code;
        if (code !== responseCode) throw new Error("The SMTP server returned an inconsistent response.");
        lines.push(line);

        if (match[2] === " ") {
          if (code !== expectedCode) {
            throw new Error(`SMTP request failed with status ${code}: ${match[3]}`);
          }
          return lines;
        }
        lineEnd = this.buffer.indexOf("\r\n");
      }

      if (this.buffer.length > 32768) {
        throw new Error("The SMTP server response is too large.");
      }

      const { value, done } = await withTimeout(
        this.reader.read(),
        "The SMTP server timed out while responding."
      );
      if (done) throw new Error("The SMTP server closed the connection unexpectedly.");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async command(command, expectedCode) {
    await withTimeout(
      this.writer.write(TEXT_ENCODER.encode(`${command}\r\n`)),
      "The SMTP server timed out while receiving a command."
    );
    return this.readResponse(expectedCode);
  }

  release() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
}

async function authenticateSmtp(session, capabilities, password) {
  const authLine = capabilities.find((line) => /^250[ -]AUTH(?:\s|$)/i.test(line)) || "";

  if (/\bPLAIN\b/i.test(authLine)) {
    await session.command(`AUTH PLAIN ${base64(`\0${SMTP_USERNAME}\0${password}`)}`, 235);
    return;
  }

  if (/\bLOGIN\b/i.test(authLine)) {
    await session.command("AUTH LOGIN", 334);
    await session.command(base64(SMTP_USERNAME), 334);
    await session.command(base64(password), 235);
    return;
  }

  throw new Error("The SMTP server does not offer a supported authentication method.");
}

async function sendFeedbackEmail(env, feedback) {
  const password = typeof env.SMTP_PASSWORD === "string" ? env.SMTP_PASSWORD : "";
  if (!password) throw new Error("SMTP_PASSWORD is not configured.");

  let socket;
  let session;

  try {
    socket = connect(
      { hostname: SMTP_HOST, port: SMTP_PORT },
      { secureTransport: "starttls" }
    );
    await withTimeout(socket.opened, "The SMTP server could not be reached.");
    session = new SmtpSession(socket);
    await session.readResponse(220);
    const capabilities = await session.command("EHLO vlsi-cad.com", 250);
    if (!capabilities.some((line) => /\bSTARTTLS\b/i.test(line))) {
      throw new Error("The SMTP server did not offer STARTTLS.");
    }
    await session.command("STARTTLS", 220);

    session.release();
    session = null;
    socket = socket.startTls();
    await withTimeout(socket.opened, "The secure SMTP connection could not be established.");
    session = new SmtpSession(socket);

    const secureCapabilities = await session.command("EHLO vlsi-cad.com", 250);
    await authenticateSmtp(session, secureCapabilities, password);
    await session.command(`MAIL FROM:<${SMTP_USERNAME}>`, 250);
    await session.command(`RCPT TO:<${RECIPIENT}>`, 250);
    await session.command("DATA", 354);
    await withTimeout(
      session.writer.write(TEXT_ENCODER.encode(`${buildEmail(feedback)}.\r\n`)),
      "The SMTP server timed out while receiving the message."
    );
    await session.readResponse(250);

    try {
      await session.command("QUIT", 221);
    } catch {
      // The message has already been accepted; a failed QUIT must not report a false failure.
    }
  } finally {
    if (session) {
      try {
        session.release();
      } catch {
        // The socket may already be closed.
      }
    }
    if (socket) {
      try {
        await socket.close();
      } catch {
        // Nothing else to clean up.
      }
    }
  }
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

    try {
      await sendFeedbackEmail(env, { name, email, background, topic, page, message });
      return json({ ok: true });
    } catch (error) {
      console.error("Feedback email failed", error?.message || "unknown");
      return json({ ok: false, error: "Feedback could not be sent right now. Please try again later." }, 503);
    }
  }
};
