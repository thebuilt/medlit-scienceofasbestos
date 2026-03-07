const CONFIG = {
  papersUrl: "./data/papers.json",
  worldTopoUrl: "./data/world/countries-110m.json",
  startYearFloor: 2000,
  themeStorageKey: "medlit_theme_v1"
};

const state = {
  papers: [],
  filtered: [],
  termCounts: {},
  countryCounts: {},
  meta: {},
  worldTopo: null,
  focusPanel: "",
  countryFilter: "",
  wordFilter: "",
  wordFocus: "",
  wordClickMode: "filter",
  lastWordNetwork: null,
  yearMin: CONFIG.startYearFloor,
  yearMax: new Date().getFullYear(),
  selectedTerms: [],
  search: "",
  theme: localStorage.getItem(CONFIG.themeStorageKey) || "dark"
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
  wordClickMode: document.getElementById("word-click-mode"),
  resetFilters: document.getElementById("reset-filters"),
  themeToggle: document.getElementById("theme-toggle"),
  activeCountryChip: document.getElementById("active-country-chip"),
  activeCountryLabel: document.getElementById("active-country-label"),
  clearCountryFilter: document.getElementById("clear-country-filter"),
  activeWordChip: document.getElementById("active-word-chip"),
  activeWordLabel: document.getElementById("active-word-label"),
  clearWordFilter: document.getElementById("clear-word-filter"),
  loadingWrap: document.getElementById("loading-wrap"),
  loadingText: document.getElementById("loading-text"),
  loadingFill: document.getElementById("loading-fill"),
  relatedWords: document.getElementById("related-words"),
  wordTrendSvg: d3.select("#word-trend"),
  exportCsv: document.getElementById("export-csv"),
  paperCountLabel: document.getElementById("paper-count-label"),
  paperList: document.getElementById("paper-list"),
  hoverCard: document.getElementById("hover-card"),
  footnote: document.getElementById("footnote"),
  layout: document.querySelector(".layout"),
  vizGrid: document.querySelector(".viz-grid"),
  focusPanels: Array.from(document.querySelectorAll(".focus-panel")),
  focusButtons: Array.from(document.querySelectorAll(".focus-btn")),
  helpButtons: Array.from(document.querySelectorAll(".help-btn")),
  panelHelps: Array.from(document.querySelectorAll(".panel-help")),
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

function setLoading(visible, message = "Loading...", progress = null) {
  dom.loadingWrap.classList.toggle("visible", visible);
  dom.loadingText.textContent = message;
  if (typeof progress === "number") {
    const pct = Math.max(0, Math.min(100, progress));
    dom.loadingFill.style.width = `${pct}%`;
  } else if (!visible) {
    dom.loadingFill.style.width = "0%";
  }
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

function mapAliases(name) {
  const aliases = {
    usa: "united states",
    us: "united states",
    "u s a": "united states",
    uk: "united kingdom",
    "south korea": "korea republic of",
    "korea south": "korea republic of",
    russia: "russian federation",
    iran: "iran islamic republic of",
    czechia: "czech republic",
    "viet nam": "vietnam"
  };
  const n = normalize(name);
  return aliases[n] || n;
}

function paperHasWord(paper, word) {
  if (!word) return false;
  return normalize(`${paper.title || ""} ${paper.abstract || ""}`).includes(normalize(word));
}

function matchesFilter(paper, options = {}) {
  const ignoreWord = Boolean(options.ignoreWord);

  if (paper.year < state.yearMin || paper.year > state.yearMax) return false;

  if (state.selectedTerms.length) {
    const matched = (paper.termsMatched || []).map(normalize);
    const matchesSelectedTerm = state.selectedTerms.some((term) => matched.includes(normalize(term)));
    if (!matchesSelectedTerm) return false;
  }

  if (state.countryFilter && mapAliases(paper.country) !== mapAliases(state.countryFilter)) {
    return false;
  }

  if (!ignoreWord && state.wordFilter && !paperHasWord(paper, state.wordFilter)) {
    return false;
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
  state.filtered = state.papers.filter((p) => matchesFilter(p)).sort((a, b) => {
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
    if (state.wordFocus && paperHasWord(paper, state.wordFocus)) {
      li.classList.add("word-hit");
    }

    const termTags = (paper.termsMatched || []).slice(0, 6).map((t) => `<span class="tag">${t}</span>`).join("");
    const wordTag = state.wordFocus && paperHasWord(paper, state.wordFocus)
      ? `<span class="tag">word: ${state.wordFocus}</span>`
      : "";

    li.innerHTML = `
      <p class="paper-title">${paper.title || "Untitled"}</p>
      <p class="paper-meta">${paper.year || "-"} | ${paper.journal || "Unknown journal"} | ${paper.firstAuthor || "Unknown"}${paper.country ? ` | ${paper.country}` : ""}</p>
      <div class="tags">${wordTag}${termTags}</div>
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
  const yearsForControls = years.length ? years : d3.range(firstYear, lastYear + 1);

  state.yearMin = firstYear;
  state.yearMax = lastYear;

  const yearOptions = yearsForControls.map((y) => `<option value="${y}">${y}</option>`).join("");
  dom.yearMin.innerHTML = yearOptions;
  dom.yearMax.innerHTML = yearOptions;

  const terms = (metaTerms && metaTerms.length) ? metaTerms : Object.keys(summarizeTerms(state.papers)).sort();
  dom.termFilter.innerHTML = terms.map((term) => `<option value="${term}">${term}</option>`).join("");
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

  const scale = d3.scaleLinear().domain(d3.extent(entries, (d) => d.count)).range([0.3, 1]);
  const selected = new Set(state.selectedTerms.map((t) => normalize(t)));

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
    .attr("stroke", (d) => selected.has(normalize(d.data.term)) ? "#ffd166" : "rgba(210, 239, 255, 0.75)")
    .attr("stroke-width", (d) => selected.has(normalize(d.data.term)) ? 2.2 : 1)
    .style("cursor", "pointer")
    .on("click", (_, d) => {
      const term = d.data.term;
      const idx = state.selectedTerms.findIndex((t) => normalize(t) === normalize(term));
      if (idx >= 0) state.selectedTerms.splice(idx, 1);
      else state.selectedTerms.push(term);
      syncUiFromState();
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

function renderWorldMap(worldTopo) {
  const svg = dom.worldSvg;
  svg.selectAll("*").remove();

  const width = 760;
  const height = 360;
  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);

  const features = topojson.feature(worldTopo, worldTopo.objects.countries).features;
  projection.fitExtent([[8, 8], [width - 8, height - 8]], { type: "FeatureCollection", features });

  const countryCountsNorm = new Map(Object.entries(state.countryCounts).map(([k, v]) => [mapAliases(k), v]));
  const max = d3.max(Object.values(state.countryCounts)) || 1;
  const color = d3.scaleSequential().domain([0, max]).interpolator(d3.interpolateYlGnBu);
  const selectedCountryNorm = mapAliases(state.countryFilter);

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
      return count ? color(count) : "var(--map-default)";
    })
    .classed("selected", (d) => mapAliases(d.properties?.name || "") === selectedCountryNorm)
    .on("mouseenter", function (_, d) {
      const rawName = d.properties?.name || "Unknown";
      const count = countryCountsNorm.get(mapAliases(rawName)) || 0;
      tooltip.text(`${rawName}: ${count.toLocaleString()} papers`);
      d3.select(this).attr("stroke", "#ccf0ff").attr("stroke-width", 1.1);
    })
    .on("mouseleave", function () {
      tooltip.text("Hover country");
      d3.select(this).attr("stroke", null).attr("stroke-width", null);
    })
    .on("click", (_, d) => {
      const clicked = String(d.properties?.name || "").trim();
      state.countryFilter = normalize(state.countryFilter) === normalize(clicked) ? "" : clicked;
      syncUiFromState();
      refresh();
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

  papers.slice(0, 1800).forEach((p) => {
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
    .slice(0, 48)
    .map(([id, value]) => ({ id, value }));

  const nodeSet = new Set(topNodes.map((n) => n.id));

  const links = [...co.entries()]
    .map(([k, value]) => {
      const [source, target] = k.split("|");
      return { source, target, value };
    })
    .filter((l) => nodeSet.has(l.source) && nodeSet.has(l.target) && l.value >= 3)
    .sort((a, b) => b.value - a.value)
    .slice(0, 140);

  return { nodes: topNodes, links };
}

function setWordSelection(word) {
  const norm = normalize(word);
  if (!norm) {
    state.wordFocus = "";
    state.wordFilter = "";
    return;
  }

  if (normalize(state.wordFocus) === norm) {
    state.wordFocus = "";
    state.wordFilter = "";
    return;
  }

  state.wordFocus = word;
  state.wordFilter = state.wordClickMode === "filter" ? word : "";
}

function renderWordMap() {
  const svg = dom.wordSvg;
  svg.selectAll("*").remove();

  const width = 1240;
  const height = 340;
  const network = buildWordNetwork(state.filtered);
  state.lastWordNetwork = network;

  if (!network.nodes.length) {
    state.wordFocus = "";
    state.wordFilter = "";
    renderRelatedWords();
    renderWordTrend();
    return;
  }

  if (!state.wordFocus) {
    const degree = new Map();
    network.links.forEach((l) => {
      const a = l.source.id || l.source;
      const b = l.target.id || l.target;
      degree.set(a, (degree.get(a) || 0) + l.value);
      degree.set(b, (degree.get(b) || 0) + l.value);
    });
    const best = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || network.nodes[0].id;
    state.wordFocus = best;
  }

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

  const selectedWordNorm = normalize(state.wordFocus);
  const connected = new Set();
  if (selectedWordNorm) {
    network.links.forEach((l) => {
      const a = normalize(l.source.id || l.source);
      const b = normalize(l.target.id || l.target);
      if (a === selectedWordNorm) connected.add(b);
      if (b === selectedWordNorm) connected.add(a);
    });
  }

  svg.append("g")
    .selectAll("line")
    .data(network.links)
    .enter()
    .append("line")
    .attr("x1", (d) => d.source.x)
    .attr("y1", (d) => d.source.y)
    .attr("x2", (d) => d.target.x)
    .attr("y2", (d) => d.target.y)
    .attr("stroke", (d) => {
      if (!selectedWordNorm) return "rgba(143, 198, 255, 0.2)";
      const a = normalize(d.source.id || d.source);
      const b = normalize(d.target.id || d.target);
      return (a === selectedWordNorm || b === selectedWordNorm)
        ? "rgba(255, 218, 122, 0.7)"
        : "rgba(143, 198, 255, 0.08)";
    })
    .attr("stroke-width", (d) => Math.min(4.5, 0.5 + d.value / 3));

  const nodes = svg.append("g")
    .selectAll("g")
    .data(network.nodes)
    .enter()
    .append("g")
    .attr("transform", (d) => `translate(${d.x},${d.y})`);

  nodes.append("circle")
    .attr("r", (d) => radius(d.value))
    .attr("fill", (d) => {
      const n = normalize(d.id);
      if (selectedWordNorm && n === selectedWordNorm) return "#ffd166";
      if (selectedWordNorm && connected.has(n)) return "#8ee7ff";
      return color(d.value);
    })
    .attr("fill-opacity", 0.9)
    .attr("stroke", "rgba(212, 241, 255, 0.8)")
    .attr("stroke-width", (d) => normalize(d.id) === selectedWordNorm ? 2.2 : 0.9)
    .style("cursor", "pointer")
    .on("click", (_, d) => {
      setWordSelection(d.id);
      syncUiFromState();
      refresh();
    });

  nodes.append("text")
    .text((d) => d.id)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("font-size", (d) => Math.max(10, radius(d.value) / 2.2))
    .attr("font-weight", 600)
    .attr("fill", "#f4fbff")
    .style("pointer-events", "none");

  renderRelatedWords();
  renderWordTrend();
}

function renderRelatedWords() {
  dom.relatedWords.innerHTML = "";
  const network = state.lastWordNetwork;
  const selected = normalize(state.wordFocus);

  if (!selected || !network) {
    dom.relatedWords.innerHTML = `<span class="panel-sub">Select a word node to see related words.</span>`;
    return;
  }

  const rel = [];
  network.links.forEach((l) => {
    const a = normalize(l.source.id || l.source);
    const b = normalize(l.target.id || l.target);
    if (a === selected) rel.push({ word: l.target.id || l.target, score: l.value });
    if (b === selected) rel.push({ word: l.source.id || l.source, score: l.value });
  });

  const uniq = new Map();
  rel.forEach((r) => {
    const key = normalize(r.word);
    uniq.set(key, Math.max(uniq.get(key) || 0, r.score));
  });

  const sorted = [...uniq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([wordNorm, score]) => {
      const original = rel.find((x) => normalize(x.word) === wordNorm)?.word || wordNorm;
      return { word: original, score };
    });

  if (!sorted.length) {
    dom.relatedWords.innerHTML = `<span class="panel-sub">No strong links for this word in current filter context.</span>`;
    return;
  }

  sorted.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "related-btn";
    btn.textContent = `${item.word} (${item.score})`;
    btn.addEventListener("click", () => {
      setWordSelection(item.word);
      syncUiFromState();
      refresh();
    });
    dom.relatedWords.appendChild(btn);
  });
}

function renderWordTrend() {
  const svg = dom.wordTrendSvg;
  svg.selectAll("*").remove();

  const width = 460;
  const height = 120;

  if (!state.wordFocus) {
    svg.append("text")
      .attr("x", 8)
      .attr("y", 22)
      .attr("fill", "var(--muted)")
      .attr("font-size", 12)
      .text("Select a word to show year trend");
    return;
  }

  const base = state.papers.filter((p) => matchesFilter(p, { ignoreWord: true }));
  const byYear = new Map();

  base.forEach((p) => {
    if (!paperHasWord(p, state.wordFocus)) return;
    byYear.set(p.year, (byYear.get(p.year) || 0) + 1);
  });

  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (!years.length) {
    svg.append("text")
      .attr("x", 8)
      .attr("y", 22)
      .attr("fill", "var(--muted)")
      .attr("font-size", 12)
      .text("No papers for this word in current filter context");
    return;
  }

  const data = years.map((year) => ({ year, count: byYear.get(year) }));
  const x = d3.scaleLinear().domain(d3.extent(years)).range([34, width - 8]);
  const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.count) || 1]).nice().range([height - 20, 10]);

  const line = d3.line()
    .x((d) => x(d.year))
    .y((d) => y(d.count));

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#ffd166")
    .attr("stroke-width", 2)
    .attr("d", line);

  svg.selectAll("circle")
    .data(data)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.year))
    .attr("cy", (d) => y(d.count))
    .attr("r", 2.2)
    .attr("fill", "#ffd166");

  const xAxis = d3.axisBottom(x).ticks(Math.min(6, years.length)).tickFormat(d3.format("d"));
  const yAxis = d3.axisLeft(y).ticks(4);

  svg.append("g")
    .attr("transform", `translate(0,${height - 20})`)
    .call(xAxis)
    .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 10))
    .call((g) => g.selectAll("line,path").attr("stroke", "var(--line)"));

  svg.append("g")
    .attr("transform", "translate(34,0)")
    .call(yAxis)
    .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 10))
    .call((g) => g.selectAll("line,path").attr("stroke", "var(--line)"));
}

function syncUiFromState() {
  dom.yearMin.value = String(state.yearMin);
  dom.yearMax.value = String(state.yearMax);
  Array.from(dom.termFilter.options).forEach((opt) => {
    opt.selected = state.selectedTerms.some((term) => normalize(term) === normalize(opt.value));
  });
  dom.wordClickMode.value = state.wordClickMode;
  dom.search.value = state.search;

  dom.activeCountryChip.style.display = state.countryFilter ? "inline-flex" : "none";
  dom.activeCountryLabel.textContent = state.countryFilter || "";

  const hasWord = Boolean(state.wordFocus);
  dom.activeWordChip.style.display = hasWord ? "inline-flex" : "none";
  dom.activeWordLabel.textContent = hasWord
    ? `${state.wordFocus}${state.wordFilter ? " (filter)" : " (highlight)"}`
    : "";

  dom.themeToggle.textContent = state.theme === "dark" ? "Switch to Light" : "Switch to Dark";
}

function applyTheme() {
  document.body.classList.toggle("theme-light", state.theme === "light");
  localStorage.setItem(CONFIG.themeStorageKey, state.theme);
}

function resetFilters() {
  const years = uniqueYears(state.papers);
  state.yearMin = years[0] || CONFIG.startYearFloor;
  state.yearMax = years[years.length - 1] || new Date().getFullYear();
  state.search = "";
  state.countryFilter = "";
  state.wordFilter = "";
  state.wordFocus = "";
  state.selectedTerms = [];
  syncUiFromState();
  refresh();
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportFilteredCsv() {
  if (!state.filtered.length) return;
  const header = ["pmid", "title", "year", "journal", "firstAuthor", "country", "termsMatched", "url"];
  const rows = state.filtered.map((p) => [
    p.pmid,
    p.title,
    p.year,
    p.journal,
    p.firstAuthor,
    p.country,
    (p.termsMatched || []).join("|"),
    p.url
  ]);

  const csv = [header, ...rows].map((r) => r.map(toCsvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medlit_filtered_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
  if (activeEl.classList.contains("list-panel")) dom.layout.classList.add("focus-list");
  else dom.layout.classList.add("focus-viz");
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

function bindHelpEvents() {
  dom.helpButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.helpTarget;
      const pane = document.getElementById(target);
      if (!pane) return;
      const isOpen = pane.classList.contains("open");
      dom.panelHelps.forEach((p) => p.classList.remove("open"));
      if (!isOpen) pane.classList.add("open");
    });
  });
}

function refreshInternal() {
  applyFilters();
  renderKpis(state.meta);
  renderPaperList();
  renderBubbleChart();
  if (state.worldTopo) renderWorldMap(state.worldTopo);
  renderWordMap();
  syncUiFromState();

  if (state.filtered.length) renderPaperHover(state.filtered[0]);
}

function refresh(message = "Updating visuals...") {
  setLoading(true, message);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      refreshInternal();
      setLoading(false);
    });
  });
}

function bindEvents() {
  dom.search.addEventListener("input", (e) => {
    state.search = e.target.value;
    refresh("Applying search filter...");
  });

  dom.yearMin.addEventListener("change", (e) => {
    state.yearMin = Number(e.target.value);
    if (state.yearMin > state.yearMax) state.yearMax = state.yearMin;
    syncUiFromState();
    refresh("Updating year range...");
  });

  dom.yearMax.addEventListener("change", (e) => {
    state.yearMax = Number(e.target.value);
    if (state.yearMax < state.yearMin) state.yearMin = state.yearMax;
    syncUiFromState();
    refresh("Updating year range...");
  });

  dom.termFilter.addEventListener("change", (e) => {
    state.selectedTerms = Array.from(e.target.selectedOptions).map((opt) => opt.value);
    refresh("Applying keyword filters...");
  });

  dom.wordClickMode.addEventListener("change", (e) => {
    state.wordClickMode = e.target.value;
    if (state.wordClickMode === "highlight") state.wordFilter = "";
    if (state.wordClickMode === "filter" && state.wordFocus) state.wordFilter = state.wordFocus;
    syncUiFromState();
    refresh("Switching word interaction mode...");
  });

  dom.resetFilters.addEventListener("click", () => {
    resetFilters();
  });

  dom.clearCountryFilter.addEventListener("click", () => {
    state.countryFilter = "";
    syncUiFromState();
    refresh("Clearing country filter...");
  });

  dom.clearWordFilter.addEventListener("click", () => {
    state.wordFilter = "";
    state.wordFocus = "";
    syncUiFromState();
    refresh("Clearing word filter...");
  });

  dom.exportCsv.addEventListener("click", () => {
    exportFilteredCsv();
  });

  dom.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    syncUiFromState();
    refresh("Switching theme...");
  });
}

async function init() {
  setLoading(true, "Loading dataset...", 10);
  const [paperData, worldTopo] = await Promise.all([
    d3.json(CONFIG.papersUrl),
    d3.json(CONFIG.worldTopoUrl)
  ]);
  setLoading(true, "Preparing dashboard...", 55);

  state.papers = (paperData.papers || []).filter((p) => Number.isInteger(p.year) && p.year >= CONFIG.startYearFloor);
  state.meta = paperData.meta || {};
  state.worldTopo = worldTopo;

  fillControls(state.meta.terms || []);
  applyTheme();
  syncUiFromState();
  refreshInternal();
  setLoading(true, "Finalizing charts...", 90);

  bindEvents();
  bindFocusEvents();
  bindHelpEvents();
  applyFocusMode();
  setLoading(false, "Ready", 100);

  dom.footnote.textContent = `Source: NCBI E-utilities (PubMed) via automated update workflow. Query start date: ${CONFIG.startYearFloor}-01-01. Last generated: ${formatDateIso(state.meta.generatedAt)}.`;
}

init().catch((err) => {
  console.error(err);
  dom.footnote.textContent = `Failed to load dashboard data: ${err.message}`;
});
