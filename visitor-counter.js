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

for (const counter of document.querySelectorAll("[data-visitor-counter]")) {
  loadCounter(counter);
}
