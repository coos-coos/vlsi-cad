import { FEEDBACK_TOPICS } from "./feedback-config.js";

const RECIPIENT = "info@vlsi-cad.com";
const SENDER = "feedback@vlsi-cad.com";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
