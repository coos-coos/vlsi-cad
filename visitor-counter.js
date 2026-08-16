function countryFlag(code) {
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
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
    const status = counter.querySelector("[data-counter-flags]");
    status.textContent = "Visitor count unavailable";
    status.classList.add("flag-counter-status");
  }
}

for (const counter of document.querySelectorAll("[data-visitor-counter]")) {
  loadCounter(counter);
}
