// ─── Settings (env editor) ────────────────────────────────────────────────────
// Displays all .env key=value pairs in an editable list.
// Saves via window.env.save() (IPC → main process writes the file).
// The "Save & Restart" button writes the file then calls app.relaunch().

const ENV_SCHEMA = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    hint: "Required for weekly digest (sk-ant-…)",
    type: "password",
  },
  {
    key: "PORT",
    label: "Server Port",
    hint: "Port the local server listens on (default: 8741)",
    type: "text",
  },
  {
    key: "HOST",
    label: "Server Host",
    hint: "Bind address (default: 127.0.0.1)",
    type: "text",
  },
  {
    key: "BRAIN_DB_PATH",
    label: "Database Path",
    hint: "Absolute path to brain.sqlite (leave blank for default)",
    type: "text",
  },
  {
    key: "MCP_SECRET",
    label: "MCP Secret",
    hint: "Bearer token for the /mcp HTTP endpoint (leave blank to disable)",
    type: "password",
  },
];

export function initSettings() {
  const modal = document.getElementById("settings-modal");
  const varsContainer = document.getElementById("settings-vars");
  const btnOpen = document.getElementById("btn-settings");
  const btnClose = document.getElementById("btn-close-settings");
  const btnCancel = document.getElementById("btn-settings-cancel");
  const btnSave = document.getElementById("btn-settings-save");
  const btnAddVar = document.getElementById("btn-settings-add-var");

  // { key, value }[] — working copy while modal is open
  let rows = [];

  // ── Render ──────────────────────────────────────────────────────────────────
  function renderRows() {
    varsContainer.innerHTML = "";

    rows.forEach((row, idx) => {
      const schema = ENV_SCHEMA.find((s) => s.key === row.key);
      const isKnown = !!schema;
      const inputType = schema?.type ?? "text";

      const div = document.createElement("div");
      div.className = "settings-row";

      // Key
      const keyWrap = document.createElement("div");
      keyWrap.className = "settings-key-wrap";

      if (isKnown) {
        const label = document.createElement("label");
        label.className = "settings-key-label";
        label.htmlFor = `settings-val-${idx}`;
        label.textContent = schema.label;
        if (schema.hint) {
          const hint = document.createElement("span");
          hint.className = "settings-key-hint";
          hint.textContent = schema.hint;
          label.appendChild(document.createElement("br"));
          label.appendChild(hint);
        }
        keyWrap.appendChild(label);
      } else {
        const keyInput = document.createElement("input");
        keyInput.className = "input settings-key-input";
        keyInput.type = "text";
        keyInput.value = row.key;
        keyInput.placeholder = "VARIABLE_NAME";
        keyInput.spellcheck = false;
        keyInput.addEventListener("input", () => {
          rows[idx].key = keyInput.value;
        });
        keyWrap.appendChild(keyInput);
      }

      // Value
      const valWrap = document.createElement("div");
      valWrap.className = "settings-val-wrap";

      const valInput = document.createElement("input");
      valInput.id = `settings-val-${idx}`;
      valInput.className = "input settings-val-input";
      valInput.type = inputType;
      valInput.value = row.value;
      valInput.placeholder = isKnown ? "" : "value";
      valInput.spellcheck = false;
      valInput.addEventListener("input", () => {
        rows[idx].value = valInput.value;
      });
      valWrap.appendChild(valInput);

      // Toggle password visibility
      if (inputType === "password") {
        const toggle = document.createElement("button");
        toggle.className = "icon-btn settings-eye";
        toggle.type = "button";
        toggle.title = "Toggle visibility";
        toggle.innerHTML = eyeIcon(false);
        let shown = false;
        toggle.addEventListener("click", () => {
          shown = !shown;
          valInput.type = shown ? "text" : "password";
          toggle.innerHTML = eyeIcon(shown);
        });
        valWrap.appendChild(toggle);
      }

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn settings-del";
      delBtn.type = "button";
      delBtn.title = "Remove variable";
      delBtn.innerHTML = "&#x2715;";
      delBtn.addEventListener("click", () => {
        rows.splice(idx, 1);
        renderRows();
      });

      div.appendChild(keyWrap);
      div.appendChild(valWrap);
      div.appendChild(delBtn);
      varsContainer.appendChild(div);
    });
  }

  // ── Open ────────────────────────────────────────────────────────────────────
  async function openSettings() {
    btnSave.disabled = true;
    btnSave.textContent = "Loading…";
    modal.removeAttribute("hidden");

    try {
      const { vars } = await window.env.read();

      // Start from schema keys (in defined order), then add any unknown keys
      const schemaKeys = ENV_SCHEMA.map((s) => s.key);
      const fromFile = new Map(vars.map((v) => [v.key, v.value]));

      rows = schemaKeys.map((key) => ({ key, value: fromFile.get(key) ?? "" }));

      // Append unknown keys found in file
      for (const { key, value } of vars) {
        if (!schemaKeys.includes(key)) rows.push({ key, value });
      }

      renderRows();
    } catch (err) {
      varsContainer.innerHTML = `<p class="list-error">Failed to load: ${err.message}</p>`;
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Save & Restart";
    }
  }

  // ── Close ───────────────────────────────────────────────────────────────────
  function closeSettings() {
    modal.setAttribute("hidden", "");
    rows = [];
    varsContainer.innerHTML = "";
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function saveSettings() {
    // Filter out rows with empty keys, strip schema rows with empty values
    const toSave = rows.filter(({ key, value }) => key.trim() && value.trim());

    btnSave.disabled = true;
    btnSave.textContent = "Saving…";

    try {
      await window.env.save(toSave);
      closeSettings();
      // Notify user that restart is needed
      showRestartBanner();
    } catch (err) {
      alert(`Could not save settings: ${err.message}`);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Save & Restart";
    }
  }

  // ── Restart banner ───────────────────────────────────────────────────────────
  function showRestartBanner() {
    const existing = document.getElementById("restart-banner");
    if (existing) return;

    const banner = document.createElement("div");
    banner.id = "restart-banner";
    banner.className = "restart-banner";
    banner.innerHTML = `
      <span>Settings saved. Restart the app to apply changes.</span>
      <button class="action-btn" id="btn-dismiss-banner">Dismiss</button>
    `;
    document.body.appendChild(banner);

    document.getElementById("btn-dismiss-banner").addEventListener("click", () => {
      banner.remove();
    });
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────
  btnOpen.addEventListener("click", openSettings);
  btnClose.addEventListener("click", closeSettings);
  btnCancel.addEventListener("click", closeSettings);
  btnSave.addEventListener("click", saveSettings);

  btnAddVar.addEventListener("click", () => {
    rows.push({ key: "", value: "" });
    renderRows();
    // Focus the last key input
    const inputs = varsContainer.querySelectorAll(".settings-key-input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  // Close on backdrop click
  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) closeSettings();
  });

  // Close on Escape (handled centrally in app.js but also here defensively)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeSettings();
  });
}

function eyeIcon(open) {
  return open
    ? `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
        <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
      </svg>`
    : `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
        <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
        <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
      </svg>`;
}
