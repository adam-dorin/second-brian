export function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export function confClass(confidence) {
  return { high: "conf-high", medium: "conf-med", low: "conf-low" }[confidence] ?? "conf-med";
}

export function renderThoughtItem(thought, onClick) {
  const li = document.createElement("li");
  li.className = "thought-item";
  li.dataset.id = thought.id;

  const text = thought.text.length > 90 ? thought.text.slice(0, 90) + "…" : thought.text;

  li.innerHTML = `
    <span class="conf-dot ${confClass(thought.confidence)}"></span>
    <div class="thought-body">
      <p class="thought-text">${escapeHtml(text)}</p>
      <div class="thought-meta">
        ${thought.context ? `<span class="tag">${escapeHtml(thought.context)}</span>` : ""}
        <span class="muted">${formatDate(thought.created_at)}</span>
      </div>
    </div>
  `;

  li.addEventListener("click", () => onClick(thought));
  return li;
}

// ─── Sidebar init ─────────────────────────────────────────────────────────────
export async function initSidebar({ onContextChange, onThoughtSelect }) {
  const contextSelect = document.getElementById("context-select");
  const recentList = document.getElementById("recent-list");
  const reviewList = document.getElementById("review-list");
  const reviewBadge = document.getElementById("review-badge");

  contextSelect.addEventListener("change", () => {
    onContextChange(contextSelect.value);
    refreshRecent();
  });

  window.addEventListener("brain:refresh", refreshAll);

  async function refreshRecent() {
    try {
      const thoughts = await window.brain.recent({
        context: contextSelect.value || undefined,
        limit: 15,
      });
      recentList.innerHTML = "";
      if (!thoughts.length) {
        recentList.innerHTML = '<li class="list-empty">No thoughts yet.</li>';
        return;
      }
      for (const t of thoughts) {
        recentList.appendChild(renderThoughtItem(t, onThoughtSelect));
      }
    } catch {
      recentList.innerHTML = '<li class="list-empty">Server not available</li>';
    }
  }

  async function refreshReviewSidebar() {
    try {
      const thoughts = await window.brain.reviewQueue(5);
      reviewList.innerHTML = "";
      if (thoughts.length) {
        reviewBadge.textContent = thoughts.length;
        reviewBadge.removeAttribute("hidden");
        for (const t of thoughts) {
          reviewList.appendChild(renderThoughtItem(t, onThoughtSelect));
        }
      } else {
        reviewBadge.setAttribute("hidden", "");
      }
    } catch {
      // silent – sidebar review is non-critical
    }
  }

  async function refreshAll() {
    await Promise.all([refreshRecent(), refreshReviewSidebar()]);
  }

  await refreshAll();
  setInterval(refreshAll, 30_000);

  return { refresh: refreshAll };
}

// ─── Context selects ──────────────────────────────────────────────────────────
export function populateContextSelects(contexts) {
  const selects = document.querySelectorAll("#context-select, #capture-context");
  selects.forEach((sel) => {
    const prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    for (const ctx of contexts) {
      const opt = new Option(ctx.name, ctx.name);
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  });
}
