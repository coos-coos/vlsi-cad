import { getFeedbackPage, getFeedbackTopic } from "./feedback-config.js";

function addFeedbackLink() {
  if (document.querySelector("[data-site-feedback-cta]")) return;

  const page = getFeedbackPage(window.location.pathname);
  const topic = getFeedbackTopic(page);
  const href = new URL("feedback.html", document.baseURI);
  href.searchParams.set("topic", topic);
  href.searchParams.set("from", page);

  const style = document.createElement("style");
  style.id = "site-feedback-styles";
  style.textContent = `
    .site-feedback-cta {
      position: relative;
      width: 100%;
      padding: clamp(28px, 5vw, 52px) clamp(20px, 6vw, 92px);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 22px;
      flex-wrap: wrap;
      border-top: 1.5px solid var(--ink, #151510);
      background: var(--ink, #151510);
      color: var(--card, #fffdf6);
      font-family: var(--sans, "Avenir Next", Avenir, "Helvetica Neue", Arial, sans-serif);
      text-align: center;
    }
    .site-private-link {
      position: absolute;
      left: clamp(8px, 1.5vw, 22px);
      top: 50%;
      padding: 12px 8px;
      color: var(--ink, #151510);
      font: 800 .68rem/1 var(--mono, "SFMono-Regular", Consolas, monospace);
      letter-spacing: .04em;
      text-decoration: none;
      opacity: 0;
      transform: translateY(-50%);
    }
    .site-private-link:hover,
    .site-private-link:visited,
    .site-private-link:active,
    .site-private-link:focus,
    .site-private-link:focus-visible {
      color: var(--ink, #151510);
      background: transparent;
      outline: none;
      opacity: 0;
    }
    .site-feedback-cta p {
      margin: 0;
      color: inherit;
      font-size: clamp(.95rem, 1.4vw, 1.12rem);
      font-weight: 800;
    }
    .site-feedback-button {
      min-height: 50px;
      padding: 0 21px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1.5px solid var(--card, #fffdf6);
      border-radius: 15px 9px 17px 11px;
      background: var(--lime, #d8ff4f);
      color: var(--ink, #151510);
      box-shadow: 4px 5px 0 var(--coral, #ff684a);
      font-weight: 950;
      line-height: 1.2;
      text-decoration: none;
      transition: transform .3s cubic-bezier(.2, 1.55, .35, 1), box-shadow .3s cubic-bezier(.2, 1.55, .35, 1);
    }
    .site-feedback-button:hover {
      transform: translateY(-3px) rotate(-.5deg);
      box-shadow: 6px 8px 0 var(--coral, #ff684a);
    }
    .site-feedback-button:focus-visible {
      outline: 3px solid var(--pink, #ff78b8);
      outline-offset: 5px;
    }
    @media (max-width: 560px) {
      .site-feedback-cta { align-items: stretch; flex-direction: column; }
      .site-feedback-button { width: 100%; }
      .site-private-link {
        width: 54px;
        height: 22px;
        left: 2px;
        top: auto;
        bottom: 2px;
        padding: 0 4px;
        display: flex;
        align-items: center;
        font-size: .55rem;
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .site-feedback-button { transition: none; }
    }
  `;

  const section = document.createElement("section");
  section.className = "site-feedback-cta";
  section.dataset.siteFeedbackCta = "";
  section.setAttribute("aria-label", "Website feedback");

  const prompt = document.createElement("p");
  prompt.textContent = "Spot something confusing or have an idea?";

  const link = document.createElement("a");
  link.className = "site-feedback-button";
  link.href = href.toString();
  link.textContent = "Leave your feedback";
  link.setAttribute("aria-label", `Leave feedback about ${topic}`);

  if (page === "index.html") {
    const privateLink = document.createElement("a");
    privateLink.className = "site-private-link";
    privateLink.href = new URL("private.html", document.baseURI).toString();
    privateLink.textContent = "Private";
    privateLink.setAttribute("aria-label", "Private");
    section.append(privateLink);
  }

  section.append(prompt, link);
  document.head.append(style);

  const footers = document.querySelectorAll("footer");
  const footer = footers[footers.length - 1];
  if (footer) footer.before(section);
  else document.body.append(section);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addFeedbackLink, { once: true });
} else {
  addFeedbackLink();
}
