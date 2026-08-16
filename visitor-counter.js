const LOCAL_PREVIEW_DATA = {
  countries: [
    { code: "IL", count: 15 },
    { code: "US", count: 7 }
  ],
  total: 22
};

function countryFlag(code) {
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function isLocalPreview() {
  return location.protocol === "file:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]" ||
    location.hostname.endsWith(".localhost");
}

function renderLocalPreview(counter) {
  renderCounter(counter, LOCAL_PREVIEW_DATA);
  const title = counter.querySelector(".flag-counter-title");
  title.textContent = "Visitors · preview";
  title.title = "Live country counts are available when the site runs on Cloudflare.";
  counter.setAttribute("aria-label", "Local preview of the visitor counter");
}

function addCounterToPage() {
  const style = document.createElement("style");
  style.textContent = `
    .visitor-counter-bar {
      box-sizing: border-box;
      width: 100%;
      padding: 26px 20px 34px;
      display: flex;
      justify-content: center;
      border-top: 1.5px solid #151510;
      background: #f7f4ea;
      color: #151510;
    }
    .visitor-counter-bar *, .visitor-counter-bar *::before, .visitor-counter-bar *::after {
      box-sizing: border-box;
    }
    .visitor-counter-bar .flag-counter {
      min-width: 156px;
      display: inline-block;
      padding: 7px;
      border: 1.5px solid #151510;
      border-radius: 11px 7px 12px 8px;
      background: #fff;
      box-shadow: 3px 4px 0 #151510;
      color: #151510;
      font: 700 .68rem/1.4 "SFMono-Regular", Consolas, monospace;
    }
    .visitor-counter-bar .flag-counter-title {
      display: block;
      margin-bottom: 4px;
      text-align: center;
      font-weight: 900;
    }
    .visitor-counter-bar .flag-counter-flags {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2px 12px;
    }
    .visitor-counter-bar .flag-counter-entry {
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .visitor-counter-bar .flag-counter-emoji { font-size: 1rem; line-height: 1; }
    .visitor-counter-bar .flag-counter-value { font-variant-numeric: tabular-nums; }
    .visitor-counter-bar .flag-counter-status { grid-column: 1 / -1; color: #66655d; }
  `;

  const bar = document.createElement("aside");
  bar.className = "visitor-counter-bar";
  bar.setAttribute("aria-label", "Site visitor statistics");

  const counter = document.createElement("div");
  counter.className = "flag-counter";
  counter.dataset.visitorCounter = "";
  counter.setAttribute("role", "group");
  counter.setAttribute("aria-label", "Visitor countries");

  const title = document.createElement("span");
  title.className = "flag-counter-title";
  title.textContent = "Visitors";

  const flags = document.createElement("span");
  flags.className = "flag-counter-flags";
  flags.dataset.counterFlags = "";

  const status = document.createElement("span");
  status.className = "flag-counter-status";
  status.textContent = "Loading…";

  flags.append(status);
  counter.append(title, flags);
  bar.append(counter);
  document.head.append(style);
  document.body.append(bar);
  return counter;
}

function countryName(code) {
  try {
    return new Intl.DisplayNames([document.documentElement.lang || "en"], { type: "region" }).of(code);
  } catch {
    return code;
  }
}

function renderCounter(counter, data) {
  const flags = counter.querySelector("[data-counter-flags]");
  flags.replaceChildren();

  for (const country of data.countries) {
    const entry = document.createElement("span");
    entry.className = "flag-counter-entry";
    entry.title = countryName(country.code);

    const flag = document.createElement("span");
    flag.className = "flag-counter-emoji";
    flag.setAttribute("aria-hidden", "true");
    flag.textContent = countryFlag(country.code);

    const value = document.createElement("span");
    value.className = "flag-counter-value";
    value.textContent = country.count.toLocaleString();

    entry.append(flag, value);
    flags.append(entry);
  }

  counter.setAttribute(
    "aria-label",
    `Visitors from ${data.countries.length} displayed countries; ${data.total.toLocaleString()} visits counted`
  );
}

async function loadCounter(counter) {
  try {
    const response = await fetch("/api/visitor-counter", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Counter request failed: ${response.status}`);
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.countries)) throw new Error("Invalid counter response");
    renderCounter(counter, data);
  } catch {
    if (isLocalPreview()) {
      renderLocalPreview(counter);
      return;
    }
    const status = counter.querySelector("[data-counter-flags]");
    status.textContent = "Visitor count unavailable";
    status.classList.add("flag-counter-status");
  }
}

const counters = [...document.querySelectorAll("[data-visitor-counter]")];
if (counters.length === 0) counters.push(addCounterToPage());

for (const counter of counters) {
  loadCounter(counter);
}
