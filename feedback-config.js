export const FEEDBACK_TOPICS = Object.freeze({
  "index.html": "VLSI Design Academy",
  "sta_academy.html": "STA Academy",
  "physical_design_academy.html": "Physical Design Academy",
  "physical-design-playground.html": "Place & Route Playground",
  "physical_design_playground.html": "Place & Route Playground",
  "flow.html": "Timing flow & basic concepts",
  "clocks.html": "Clock definition",
  "cell.html": "Cell modeling",
  "interconnect.html": "Interconnect modeling",
  "constraints.html": "Constraint definition",
  "checks.html": "Timing checks",
  "paths.html": "Path analysis & enumeration",
  "variation.html": "Variation handling",
  "crosstalk.html": "Crosstalk"
});

export function getFeedbackPage(pathname) {
  const page = decodeURIComponent(String(pathname || "").split("/").pop() || "index.html");
  return Object.hasOwn(FEEDBACK_TOPICS, page) ? page : "index.html";
}

export function getFeedbackTopic(page) {
  return FEEDBACK_TOPICS[page] || FEEDBACK_TOPICS["index.html"];
}
