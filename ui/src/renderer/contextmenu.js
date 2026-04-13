export function initContextMenu(editor) {
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("hidden", "");
  document.body.appendChild(menu);

  const ITEMS = [
    { label: "Cut", cmd: () => document.execCommand("cut"), needsSel: true },
    { label: "Copy", cmd: () => document.execCommand("copy"), needsSel: true },
    { label: "Paste", cmd: () => document.execCommand("paste") },
    { type: "sep" },
    { label: "Bold", hint: "Ctrl+B", cmd: () => editor.execCommand("strong") },
    { label: "Italic", hint: "Ctrl+I", cmd: () => editor.execCommand("em") },
    { label: "Strikethrough", cmd: () => editor.execCommand("strike") },
    { label: "Inline Code", cmd: () => editor.execCommand("code_inline") },
    { type: "sep" },
    { label: "Heading 1", cmd: () => editor.execCommand("h1") },
    { label: "Heading 2", cmd: () => editor.execCommand("h2") },
    { label: "Heading 3", cmd: () => editor.execCommand("h3") },
    { type: "sep" },
    { label: "Bullet List", cmd: () => editor.execCommand("bullet_list") },
    { label: "Ordered List", cmd: () => editor.execCommand("ordered_list") },
    { label: "Code Block", cmd: () => editor.execCommand("code_block") },
    { label: "Blockquote", cmd: () => editor.execCommand("blockquote") },
    { type: "sep" },
    { label: "→ Save to Brain", accent: true, cmd: () => document.getElementById("btn-save-brain").click() },
  ];

  function render() {
    menu.innerHTML = "";
    const hasSel = !window.getSelection()?.isCollapsed;

    for (const item of ITEMS) {
      if (item.type === "sep") {
        const s = document.createElement("div");
        s.className = "ctx-sep";
        menu.appendChild(s);
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "ctx-item" + (item.accent ? " ctx-item--accent" : "");
      const disabled = item.needsSel && !hasSel;
      if (disabled) btn.classList.add("ctx-item--disabled");

      const labelEl = document.createElement("span");
      labelEl.className = "ctx-label";
      labelEl.textContent = item.label;
      btn.appendChild(labelEl);

      if (item.hint) {
        const hintEl = document.createElement("span");
        hintEl.className = "ctx-hint";
        hintEl.textContent = item.hint;
        btn.appendChild(hintEl);
      }

      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        hide();
        if (!disabled) item.cmd();
      });
      menu.appendChild(btn);
    }
  }

  function show(x, y) {
    render();
    menu.removeAttribute("hidden");
    // initial render needed to measure size
    requestAnimationFrame(() => {
      const { width, height } = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      menu.style.left = Math.min(x, vw - width - 8) + "px";
      menu.style.top = Math.min(y, vh - height - 8) + "px";
    });
  }

  function hide() {
    menu.setAttribute("hidden", "");
  }

  document.getElementById("editor-wrap").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    show(e.clientX, e.clientY);
  });

  document.addEventListener("mousedown", (e) => {
    if (!menu.contains(e.target)) hide();
  });
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}
