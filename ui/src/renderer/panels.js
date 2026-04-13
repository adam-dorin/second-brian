import { escapeHtml, formatDate, confClass } from "./sidebar.js";

// ─── Thought card (search / review panels) ────────────────────────────────────
function renderThoughtCard(thought, onLoad) {
  const li = document.createElement("li");
  li.className = "result-card";
  li.dataset.id = thought.id;

  const text = thought.text.length > 220 ? thought.text.slice(0, 220) + "…" : thought.text;

  li.innerHTML = `
    <div class="card-header">
      <span class="card-id">#${thought.id}</span>
      <span class="conf-pill ${confClass(thought.confidence)}">${thought.confidence ?? "medium"}</span>
      ${thought.context ? `<span class="tag">${escapeHtml(thought.context)}</span>` : ""}
      <span class="muted ml-auto">${formatDate(thought.created_at)}</span>
    </div>
    <p class="card-text">${escapeHtml(text)}</p>
    <div class="card-actions">
      <button class="card-btn card-btn--load" title="Load into editor">Load</button>
      <button class="card-btn card-btn--confirm" title="Mark high confidence">✓ Confirm</button>
      <button class="card-btn card-btn--dispute" title="Mark low confidence">✗ Dispute</button>
    </div>
  `;

  li.querySelector(".card-btn--load").addEventListener("click", (e) => {
    e.stopPropagation();
    if (onLoad) onLoad(thought);
  });

  li.querySelector(".card-btn--confirm").addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await window.brain.confirm(thought.id);
      const pill = li.querySelector(".conf-pill");
      pill.className = `conf-pill conf-high`;
      pill.textContent = "high";
    } catch (err) {
      console.error(err);
    }
  });

  li.querySelector(".card-btn--dispute").addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await window.brain.dispute(thought.id);
      const pill = li.querySelector(".conf-pill");
      pill.className = `conf-pill conf-low`;
      pill.textContent = "low";
    } catch (err) {
      console.error(err);
    }
  });

  return li;
}

// ─── Pattern renderer ─────────────────────────────────────────────────────────
function renderPatterns(patterns) {
  if (!Array.isArray(patterns) || !patterns.length) {
    return '<p class="list-empty">No significant patterns detected yet.</p>';
  }

  const groups = {};
  for (const p of patterns) {
    const key = p.type ?? "other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  const humanType = {
    topicSpike: "Topic Spikes",
    crossContext: "Cross-Context Clusters",
    recurringUnsolved: "Recurring Unsolved",
    dormant: "Dormant High-Value",
    other: "Patterns",
  };

  return Object.entries(groups)
    .map(
      ([type, items]) => `
    <div class="pattern-group">
      <h4 class="pattern-title">${humanType[type] ?? type}</h4>
      <ul class="pattern-list">
        ${items
          .map(
            (p) => `
          <li class="pattern-item">
            ${p.topic ? `<span class="tag">${escapeHtml(p.topic)}</span> ` : ""}
            ${p.count ? `<span class="muted">${p.count} thoughts</span> ` : ""}
            ${p.text ? `<span>${escapeHtml(p.text.slice(0, 120))}</span>` : ""}
            ${!p.topic && !p.count && !p.text ? `<span class="muted">${escapeHtml(JSON.stringify(p).slice(0, 150))}</span>` : ""}
          </li>
        `,
          )
          .join("")}
      </ul>
    </div>
  `,
    )
    .join("");
}

// ─── Panels init ──────────────────────────────────────────────────────────────
export function initPanels({ onThoughtLoad }) {
  // ── Search ──────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById("search-input");
  const btnSearch = document.getElementById("btn-search");
  const searchResults = document.getElementById("search-results");

  async function doSearch() {
    const q = searchInput.value.trim();
    if (!q) return;
    searchResults.innerHTML = '<li class="list-loading">Searching…</li>';
    try {
      const results = await window.brain.search(q, { limit: 10 });
      searchResults.innerHTML = "";
      if (!results.length) {
        searchResults.innerHTML = '<li class="list-empty">No results.</li>';
        return;
      }
      for (const t of results) searchResults.appendChild(renderThoughtCard(t, onThoughtLoad));
    } catch (err) {
      searchResults.innerHTML = `<li class="list-error">Error: ${escapeHtml(err.message)}</li>`;
    }
  }

  btnSearch.addEventListener("click", doSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  // ── Patterns ─────────────────────────────────────────────────────────────────
  document.getElementById("btn-patterns").addEventListener("click", async () => {
    const out = document.getElementById("patterns-output");
    out.innerHTML = '<p class="list-loading">Detecting patterns…</p>';
    try {
      const patterns = await window.brain.patterns();
      out.innerHTML = renderPatterns(patterns);
    } catch (err) {
      out.innerHTML = `<p class="list-error">Error: ${escapeHtml(err.message)}</p>`;
    }
  });

  // ── Review queue (panel) ──────────────────────────────────────────────────────
  document.getElementById("btn-review-load").addEventListener("click", async () => {
    const list = document.getElementById("panel-review-list");
    list.innerHTML = '<li class="list-loading">Loading…</li>';
    try {
      const thoughts = await window.brain.reviewQueue(20);
      list.innerHTML = "";
      if (!thoughts.length) {
        list.innerHTML = '<li class="list-empty">Queue is empty! 🎉</li>';
        return;
      }
      for (const t of thoughts) list.appendChild(renderThoughtCard(t, onThoughtLoad));
    } catch (err) {
      list.innerHTML = `<li class="list-error">Error: ${escapeHtml(err.message)}</li>`;
    }
  });

  // ── Weekly digest ──────────────────────────────────────────────────────────
  document.getElementById("btn-digest").addEventListener("click", async () => {
    const out = document.getElementById("digest-output");
    out.innerHTML = '<p class="list-loading">Generating… this may take 30–60 seconds.</p>';
    try {
      const data = await window.brain.digest();
      if (data.error) throw new Error(data.error);
      out.innerHTML = `<div class="digest-body">${escapeHtml(data.digest).replace(/\n/g, "<br>")}</div>`;
    } catch (err) {
      out.innerHTML = `<p class="list-error">${escapeHtml(err.message)}</p>`;
    }
  });
}
