const CONFIG = {
  papersUrl: "./data/papers.json",
  worldTopoUrl: "./data/world/countries-110m.json",
  startYearFloor: 2000
};

const state = {
  papers: [],
  filtered: [],
  termCounts: {},
  countryCounts: {},
  worldTopo: null,
  focusPanel: "",
  yearMin: CONFIG.startYearFloor,
  yearMax: new Date().getFullYear(),
  termFilter: "all",
  search: ""
};

const normalize = (v) => String(v || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const dom = {
  total: document.getElementById("kpi-total"),
  countries: document.getElementById("kpi-countries"),
  latestYear: document.getElementById("kpi-latest-year"),
  updated: document.getElementById("kpi-updated"),
  search: document.getElementById("search-input"),
  yearMin: document.getElementById("year-min"),
  yearMax: document.getElementById("year-max"),
  termFilter: document.getElementById("term-filter"),
  paperCountLabel: document.getElementById("paper-count-label"),
  paperList: document.getElementById("paper-list"),
  hoverCard: document.getElementById("hover-card"),
  footnote: document.getElementById("footnote"),
  layout: document.querySelector(".layout"),
  vizGrid: document.querySelector(".viz-grid"),
  focusPanels: Array.from(document.querySelectorAll(".focus-panel")),
  focusButtons: Array.from(document.querySelectorAll(".focus-btn")),
  bubbleSvg: d3.select("#bubble-chart"),
  worldSvg: d3.select("#world-map"),
  wordSvg: d3.select("#word-map")
};

function formatDateIso(dateIso) {
  if (!dateIso) return "-";
  const dt = new Date(dateIso);
  if (Number.isNaN(dt.getTime())) return dateIso;
  return dt.toISOString().slice(0, 10);
}

function uniqueYears(papers) {
  return [...new Set(papers.map((p) => p.year).filter((y) => Number.isInteger(y)))].sort((a, b) => a - b);
}

function summarizeTerms(papers) {
  const counts = {};
  papers.forEach((p) => {
    (p.termsMatched || []).forEach((term) => {
      counts[term] = (counts[term] || 0) + 1;
    });
  });
  return counts;
}

function summarizeCountries(papers) {
  const counts = {};
  papers.forEach((p) => {
    if (!p.country) return;
    counts[p.country] = (counts[p.country] || 0) + 1;
  });
  return counts;
}

function matchesFilter(paper) {
  if (paper.year < state.yearMin || paper.year > state.yearMax) return false;

  if (state.termFilter !== "all") {
    const matched = (paper.termsMatched || []).map(normalize);
    if (!matched.includes(normalize(state.termFilter))) return false;
  }

  if (!state.search) return true;
  const s = normalize(state.search);
  return normalize(paper.title).includes(s)
    || normalize(paper.abstract).includes(s)
    || normalize(paper.firstAuthor).includes(s)
    || normalize(paper.country).includes(s)
    || normalize((paper.termsMatched || []).join(" ")).includes(s);
}

function applyFilters() {
  state.filtered = state.papers.filter(matchesFilter).sort((a, b) => {
    const ad = new Date(a.pubDate || `${a.year}-01-01`).getTime();
    const bd = new Date(b.pubDate || `${b.year}-01-01`).getTime();
    return bd - ad;
  });

  state.termCounts = summarizeTerms(state.filtered);
  state.countryCounts = summarizeCountries(state.filtered);
}

function renderPaperHover(paper) {
  dom.hoverCard.innerHTML = `
    <h3>${paper.title || "Untitled"}</h3>
    <p class="hover-meta">${paper.year || "-"} | ${paper.journal || "Unknown journal"} | ${paper.firstAuthor || "Unknown author"}${paper.country ? ` | ${paper.country}` : ""}</p>
    <p class="hover-abstract">${paper.abstract || "No abstract available from source."}</p>
  `;
}

function renderPaperList() {
  dom.paperList.innerHTML = "";
  dom.paperCountLabel.textContent = `${state.filtered.length.toLocaleString()} papers`;

  if (!state.filtered.length) {
    dom.paperList.innerHTML = `<li class="empty">No papers match current filters.</li>`;
    return;
  }

  const frag = document.createDocumentFragment();

  state.filtered.forEach((paper) => {
    const li = document.createElement("li");
    li.className = "paper-item";

    li.innerHTML = `
      <p class="paper-title">${paper.title || "Untitled"}</p>
      <p class="paper-meta">${paper.year || "-"} | ${paper.journal || "Unknown journal"} | ${paper.firstAuthor || "Unknown"}${paper.country ? ` | ${paper.country}` : ""}</p>
      <div class="tags">${(paper.termsMatched || []).slice(0, 6).map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    `;

    li.addEventListener("mouseenter", () => renderPaperHover(paper));
    li.addEventListener("focus", () => renderPaperHover(paper));
    li.addEventListener("click", () => {
      if (paper.url) window.open(paper.url, "_blank", "noopener");
    });

    frag.appendChild(li);
  });

  dom.paperList.appendChild(frag);
}

function fillControls(metaTerms) {
  const years = uniqueYears(state.papers);
  const firstYear = years[0] || CONFIG.startYearFloor;
  const lastYear = years[years.length - 1] || new Date().getFullYear();
  const yearsForControls = years.length
    ? years
    : d3.range(firstYear, lastYear + 1);

  state.yearMin = firstYear;
  state.yearMax = lastYear;

  const yearOptions = yearsForControls.map((y) => `<option value="${y}">${y}</option>`).join("");
  dom.yearMin.innerHTML = yearOptions;
  dom.yearMax.innerHTML = yearOptions;
  dom.yearMin.value = String(firstYear);
  dom.yearMax.value = String(lastYear);

  const termOptions = ["all", ...(metaTerms || Object.keys(summarizeTerms(state.papers)).sort())]
    .map((term) => `<option value="${term}">${term === "all" ? "All terms" : term}</option>`)
    .join("");
  dom.termFilter.innerHTML = termOptions;
}

function renderKpis(meta) {
  const years = uniqueYears(state.filtered);
  dom.total.textContent = state.filtered.length.toLocaleString();
  dom.countries.textContent = Object.keys(state.countryCounts).length.toLocaleString();
  dom.latestYear.textContent = years.length ? years[years.length - 1] : "-";
  dom.updated.textContent = formatDateIso(meta.generatedAt);
}

function renderBubbleChart() {
  const svg = dom.bubbleSvg;
  svg.selectAll("*").remove();

  const width = 760;
  const height = 360;
  const entries = Object.entries(state.termCounts)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  if (!entries.length) return;

  const root = d3.hierarchy({ children: entries }).sum((d) => d.count);
  const pack = d3.pack().size([width, height]).padding(6);
  const nodes = pack(root).leaves();

  const scale = d3.scaleLinear()
    .domain(d3.extent(entries, (d) => d.count))
    .range([0.3, 1]);

  const g = svg.append("g");

  g.selectAll("circle")
    .data(nodes)
    .enter()
    .append("circle")
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", (d) => d.r)
    .attr("fill", (d) => d3.interpolateTurbo(scale(d.data.count)))
    .attr("fill-opacity", 0.86)
    .attr("stroke", "rgba(210, 239, 255, 0.75)")
    .attr("stroke-width", 1)
    .style("cursor", "pointer")
    .on("click", (_, d) => {
      state.termFilter = d.data.term;
      dom.termFilter.value = d.data.term;
      refresh();
    });

  g.selectAll("text")
    .data(nodes)
    .enter()
    .append("text")
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("fill", "#f7fbff")
    .attr("font-size", (d) => Math.max(10, d.r / 3.5))
    .attr("font-weight", 700)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("pointer-events", "none")
    .text((d) => {
      const max = Math.max(4, Math.floor(d.r / 5));
      return d.data.term.length > max ? `${d.data.term.slice(0, max)}...` : d.data.term;
    });
}

function mapAliases(name) {
  const aliases = {
    "usa": "united states",
    "us": "united states",
    "u s a": "united states",
    "uk": "united kingdom",
    "south korea": "korea republic of",
    "korea south": "korea republic of",
    "russia": "russian federation",
    "iran": "iran islamic republic of",
    "czechia": "czech republic",
    "viet nam": "vietnam"
  };
  const n = normalize(name);
  return aliases[n] || n;
}

function renderWorldMap(worldTopo) {
  const svg = dom.worldSvg;
  svg.selectAll("*").remove();

  const width = 760;
  const height = 360;

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);

  const features = topojson.feature(worldTopo, worldTopo.objects.countries).features;
  projection.fitExtent([[8, 8], [width - 8, height - 8]], { type: "FeatureCollection", features });

  const countryCountsNorm = new Map(
    Object.entries(state.countryCounts).map(([k, v]) => [mapAliases(k), v])
  );

  const max = d3.max(Object.values(state.countryCounts)) || 1;
  const color = d3.scaleSequential().domain([0, max]).interpolator(d3.interpolateYlGnBu);

  const tooltip = svg.append("text").attr("class", "map-tip").attr("x", 12).attr("y", 22).text("Hover country");

  svg.append("g")
    .selectAll("path")
    .data(features)
    .enter()
    .append("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", (d) => {
      const name = mapAliases(d.properties?.name || "");
      const count = countryCountsNorm.get(name) || 0;
      return count ? color(count) : "rgba(22, 43, 66, 0.9)";
    })
    .on("mouseenter", function (_, d) {
      const rawName = d.properties?.name || "Unknown";
      const count = countryCountsNorm.get(mapAliases(rawName)) || 0;
      tooltip.text(`${rawName}: ${count.toLocaleString()} papers`);
      d3.select(this).attr("stroke", "#ccf0ff").attr("stroke-width", 1.1);
    })
    .on("mouseleave", function () {
      tooltip.text("Hover country");
      d3.select(this).attr("stroke", "rgba(171, 211, 248, 0.45)").attr("stroke-width", 0.4);
    });
}

function tokenize(text) {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildWordNetwork(papers) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "were", "was", "are", "have", "has", "had", "but", "not", "into", "their", "than", "then", "its", "our", "over", "under", "between", "among", "using", "used", "use", "study", "studies", "results", "background", "methods", "conclusion", "conclusions", "abstract", "patients", "patient", "analysis", "data", "risk", "exposure", "disease", "health", "asbestos", "mesothelioma"
  ]);

  const freq = new Map();
  const co = new Map();

  papers.slice(0, 1600).forEach((p) => {
    const words = [...new Set(tokenize(`${p.title || ""} ${p.abstract || ""}`).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, 24);

    words.forEach((w) => {
      freq.set(w, (freq.get(w) || 0) + 1);
    });

    for (let i = 0; i < words.length; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        const a = words[i];
        const b = words[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        co.set(key, (co.get(key) || 0) + 1);
      }
    }
  });

  const topNodes = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 42)
    .map(([id, value]) => ({ id, value }));

  const nodeSet = new Set(topNodes.map((n) => n.id));

  const links = [...co.entries()]
    .map(([k, value]) => {
      const [source, target] = k.split("|");
      return { source, target, value };
    })
    .filter((l) => nodeSet.has(l.source) && nodeSet.has(l.target) && l.value >= 3)
    .sort((a, b) => b.value - a.value)
    .slice(0, 120);

  return { nodes: topNodes, links };
}

function renderWordMap() {
  const svg = dom.wordSvg;
  svg.selectAll("*").remove();

  const width = 1240;
  const height = 340;
  const network = buildWordNetwork(state.filtered);

  if (!network.nodes.length) return;

  const valueExtent = d3.extent(network.nodes, (d) => d.value);
  const radius = d3.scaleSqrt().domain(valueExtent).range([8, 30]);
  const color = d3.scaleSequential().domain(valueExtent).interpolator(d3.interpolatePlasma);

  const simulation = d3.forceSimulation(network.nodes)
    .force("link", d3.forceLink(network.links).id((d) => d.id).distance((d) => 130 - Math.min(d.value * 2, 80)).strength(0.12))
    .force("charge", d3.forceManyBody().strength(-92))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((d) => radius(d.value) + 5))
    .stop();

  for (let i = 0; i < 220; i += 1) simulation.tick();

  svg.append("g")
    .attr("stroke", "rgba(143, 198, 255, 0.2)")
    .selectAll("line")
    .data(network.links)
    .enter()
    .append("line")
    .attr("x1", (d) => d.source.x)
    .attr("y1", (d) => d.source.y)
    .attr("x2", (d) => d.target.x)
    .attr("y2", (d) => d.target.y)
    .attr("stroke-width", (d) => Math.min(4.5, 0.5 + d.value / 3));

  const nodes = svg.append("g")
    .selectAll("g")
    .data(network.nodes)
    .enter()
    .append("g")
    .attr("transform", (d) => `translate(${d.x},${d.y})`);

  nodes.append("circle")
    .attr("r", (d) => radius(d.value))
    .attr("fill", (d) => color(d.value))
    .attr("fill-opacity", 0.9)
    .attr("stroke", "rgba(212, 241, 255, 0.8)")
    .attr("stroke-width", 0.9);

  nodes.append("text")
    .text((d) => d.id)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("font-size", (d) => Math.max(10, radius(d.value) / 2.2))
    .attr("font-weight", 600)
    .attr("fill", "#f4fbff")
    .style("pointer-events", "none");
}

function syncUiFromState() {
  dom.yearMin.value = String(state.yearMin);
  dom.yearMax.value = String(state.yearMax);
  dom.termFilter.value = state.termFilter;
  dom.search.value = state.search;
}

function applyFocusMode() {
  const activePanel = state.focusPanel;
  const hasFocus = Boolean(activePanel);

  dom.layout.classList.toggle("focus-mode", hasFocus);
  dom.vizGrid.classList.toggle("focus-mode", hasFocus);
  dom.layout.classList.remove("focus-viz", "focus-list");

  dom.focusPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === activePanel;
    panel.classList.toggle("active", hasFocus && isActive);
    panel.classList.toggle("dimmed", hasFocus && !isActive);
  });

  dom.focusButtons.forEach((btn) => {
    const isActive = btn.dataset.focusTarget === activePanel;
    btn.textContent = isActive ? "Back to Grid" : "Focus";
    btn.setAttribute("aria-pressed", String(isActive));
  });

  if (!hasFocus) return;

  const activeEl = dom.focusPanels.find((panel) => panel.dataset.panel === activePanel);
  if (!activeEl) return;
  if (activeEl.classList.contains("list-panel")) {
    dom.layout.classList.add("focus-list");
  } else {
    dom.layout.classList.add("focus-viz");
  }
}

function bindFocusEvents() {
  dom.focusButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.focusTarget || "";
      state.focusPanel = state.focusPanel === target ? "" : target;
      applyFocusMode();
    });
  });
}

function refresh(meta = {}) {
  applyFilters();
  renderKpis(meta);
  renderPaperList();
  renderBubbleChart();
  if (state.worldTopo) renderWorldMap(state.worldTopo);
  renderWordMap();

  if (state.filtered.length) {
    renderPaperHover(state.filtered[0]);
  }
}

function bindEvents(meta) {
  dom.search.addEventListener("input", (e) => {
    state.search = e.target.value;
    refresh(meta);
  });

  dom.yearMin.addEventListener("change", (e) => {
    state.yearMin = Number(e.target.value);
    if (state.yearMin > state.yearMax) state.yearMax = state.yearMin;
    syncUiFromState();
    refresh(meta);
  });

  dom.yearMax.addEventListener("change", (e) => {
    state.yearMax = Number(e.target.value);
    if (state.yearMax < state.yearMin) state.yearMin = state.yearMax;
    syncUiFromState();
    refresh(meta);
  });

  dom.termFilter.addEventListener("change", (e) => {
    state.termFilter = e.target.value;
    refresh(meta);
  });
}

async function init() {
  const [paperData, worldTopo] = await Promise.all([
    d3.json(CONFIG.papersUrl),
    d3.json(CONFIG.worldTopoUrl)
  ]);

  state.papers = (paperData.papers || []).filter((p) => Number.isInteger(p.year) && p.year >= CONFIG.startYearFloor);
  state.worldTopo = worldTopo;

  fillControls(paperData.meta?.terms || []);
  syncUiFromState();
  refresh(paperData.meta || {});

  bindEvents(paperData.meta || {});
  bindFocusEvents();
  applyFocusMode();

  dom.footnote.textContent = `Source: NCBI E-utilities (PubMed) via automated update workflow. Query start date: ${CONFIG.startYearFloor}-01-01. Last generated: ${formatDateIso(paperData.meta?.generatedAt)}.`;
}

init().catch((err) => {
  console.error(err);
  dom.footnote.textContent = `Failed to load dashboard data: ${err.message}`;
});
