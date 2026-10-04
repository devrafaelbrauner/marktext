const u = (s, n) => Object.assign(new Error(n), { code: s });
class p {
  port;
  seq = 1;
  pending = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Map();
  reverse = /* @__PURE__ */ new Map();
  constructor(n) {
    this.port = n, n.addEventListener("message", (i) => {
      this.onMessage(i.data);
    }), n.start();
  }
  call(n, i) {
    const r = this.seq++;
    let o = () => {
    }, e = () => {
    };
    const t = new Promise((a, c) => {
      o = a, e = c;
    });
    return this.pending.set(r, { resolve: o, reject: e }), this.port.postMessage({ id: r, method: n, args: i === void 0 ? [] : [i] }), t;
  }
  on(n, i) {
    const r = this.listeners.get(n) ?? /* @__PURE__ */ new Set();
    return r.add(i), this.listeners.set(n, r), { dispose: () => r.delete(i) };
  }
  handle(n, i) {
    this.reverse.set(n, i);
  }
  async onMessage(n) {
    if (!(!n || typeof n != "object")) {
      if ("ok" in n && "id" in n && typeof n.id == "number") {
        const i = this.pending.get(n.id);
        if (this.pending.delete(n.id), !i)
          return;
        if (n.ok === !0)
          i.resolve("value" in n ? n.value : void 0);
        else {
          const r = "error" in n && n.error && typeof n.error == "object" ? n.error : null, o = r && "code" in r && typeof r.code == "string" ? r.code : "FAILED", e = r && "message" in r && typeof r.message == "string" ? r.message : "RPC failed";
          i.reject(u(o, e));
        }
        return;
      }
      if ("method" in n && "id" in n && typeof n.method == "string" && typeof n.id == "string") {
        const i = "args" in n && Array.isArray(n.args) ? n.args : [], r = this.reverse.get(n.method);
        try {
          const o = r ? await r(i) : void 0;
          this.port.postMessage({ id: n.id, ok: !0, value: o });
        } catch (o) {
          const e = o instanceof Error ? o.message : String(o);
          this.port.postMessage({ id: n.id, ok: !1, error: { code: "FAILED", message: e } });
        }
        return;
      }
      if ("event" in n && typeof n.event == "string") {
        const i = "payload" in n ? n.payload : void 0;
        for (const r of this.listeners.get(n.event) ?? [])
          r(i);
      }
    }
  }
}
const l = async (s, n, i, r) => {
  const o = await s.call(n, {}), e = s.on(i, r);
  return {
    dispose() {
      e.dispose(), s.call("dispose", { handle: o.handle });
    }
  };
}, f = (s, n) => {
  let i = n.language;
  const r = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map();
  return s.handle("command.run", async (e) => {
    const t = e[0], a = t && typeof t == "object" && "id" in t && typeof t.id == "string" ? t.id : "", c = r.get(a);
    if (!c)
      throw new Error(`Unknown command ${a}`);
    await c();
  }), s.handle("codeblock.render", async (e) => {
    const t = e[0];
    if (!t || typeof t != "object" || !("token" in t))
      return "";
    const a = typeof t.token == "string" ? o.get(t.token) : void 0;
    if (!a)
      return "";
    const c = "source" in t && typeof t.source == "string" ? t.source : "", d = "lang" in t && typeof t.lang == "string" ? t.lang : "";
    return a.render({ source: c, lang: d });
  }), s.handle("codeblock.exportHtml", async (e) => {
    const t = e[0];
    if (!t || typeof t != "object" || !("token" in t) || typeof t.token != "string")
      return "";
    const a = o.get(t.token);
    if (!a?.exportHtml)
      return "";
    const c = "source" in t && typeof t.source == "string" ? t.source : "", d = "lang" in t && typeof t.lang == "string" ? t.lang : "";
    return a.exportHtml(c, d);
  }), s.on("host:language", (e) => {
    e && typeof e == "object" && "language" in e && typeof e.language == "string" && (i = e.language);
  }), {
    manifest: n.manifest,
    get language() {
      return i;
    },
    settings: {
      get: (e) => s.call("settings.get", { key: e }),
      set: (e, t) => s.call("settings.set", { key: e, value: t }),
      onDidChange: (e) => l(s, "settings.subscribe", "settings:change", (t) => {
        t && typeof t == "object" && "key" in t && e(String(t.key), "value" in t ? t.value : void 0);
      })
    },
    commands: {
      register: async (e) => {
        r.set(e.id, e.run);
        const t = await s.call("commands.register", {
          id: e.id,
          title: e.title,
          keybinding: e.keybinding
        });
        return {
          dispose() {
            r.delete(e.id), s.call("dispose", { handle: t.handle });
          }
        };
      }
    },
    notify: (e) => s.call("notify", e),
    openSettings: () => s.call("ui.openSettings"),
    editor: {
      getMarkdown: () => s.call("editor.getMarkdown"),
      getActiveTab: () => s.call("editor.getActiveTab"),
      getCheckableBlocks: (e) => s.call("editor.getCheckableBlocks", e === void 0 ? {} : { paths: e }),
      onDidChangeContent: (e) => l(s, "editor.subscribeContent", "editor:content-change", e),
      onDidChangeActiveTab: (e) => l(s, "editor.subscribeActiveTab", "editor:active-tab", e),
      onDidSetContent: (e) => l(s, "editor.subscribeSetContent", "editor:set-content", e),
      insertText: (e) => s.call("editor.insertText", { text: e }),
      replaceRange: (e) => s.call("editor.replaceRange", e),
      setDecorations: (e, t) => s.call("editor.setDecorations", { layerId: e, ranges: t }),
      clearDecorations: (e) => s.call("editor.clearDecorations", { layerId: e }),
      onDidClickDecoration: (e, t) => l(s, "editor.subscribeDecorationClick", "editor:decoration-click", (a) => {
        a && typeof a == "object" && "layerId" in a && a.layerId === e && t(a);
      }),
      registerCodeBlockRenderer: async (e) => {
        const t = await s.call("editor.registerCodeBlockRenderer", {
          lang: e.lang,
          debounceMs: e.debounceMs
        });
        return o.set(t.handle, e), {
          dispose() {
            o.delete(t.handle), s.call("dispose", { handle: t.handle });
          }
        };
      }
    },
    vault: {
      readText: (e) => s.call("vault.readText", { path: e }),
      readBinary: (e, t) => s.call("vault.readBinary", { path: e, maxBytes: t }),
      exists: (e) => s.call("vault.exists", { path: e }),
      list: (e) => s.call("vault.list", e ?? {}),
      writeText: (e, t, a) => s.call("vault.writeText", { path: e, content: t, ...a }),
      createText: (e, t) => s.call("vault.createText", { path: e, content: t })
    },
    metadata: {
      isReady: () => s.call("metadata.isReady"),
      getFile: (e) => s.call("metadata.getFile", { path: e }),
      listFiles: () => s.call("metadata.listFiles"),
      resolveLink: (e, t) => s.call("metadata.resolveLink", { target: e, sourcePath: t }),
      getBacklinks: (e) => s.call("metadata.getBacklinks", { path: e }),
      getTags: () => s.call("metadata.getTags"),
      getFilesWithTag: (e, t) => s.call("metadata.getFilesWithTag", { tag: e, ...t }),
      subscribe: (e) => l(s, "metadata.subscribe", "metadata:change", (t) => {
        e({ event: "change", payload: t });
      })
    },
    net: {
      fetch: (e, t) => s.call("net.fetch", { url: e, ...t })
    },
    ui: {
      registerSidebarPanel: (e) => s.call("ui.registerSidebarPanel", e).then((t) => ({
        dispose() {
          const a = t && typeof t == "object" && "handle" in t ? String(t.handle) : "";
          s.call("dispose", { handle: a });
        }
      })),
      revealSidebarPanel: (e) => s.call("ui.revealSidebarPanel", { id: e }),
      registerStatusBarItem: (e) => s.call("ui.registerStatusBarItem", e).then((t) => ({
        dispose() {
          const a = t && typeof t == "object" && "handle" in t ? String(t.handle) : "";
          s.call("dispose", { handle: a });
        }
      })),
      updateStatusBarItem: (e, t) => s.call("ui.updateStatusBarItem", { id: e, ...t })
    },
    clipboard: {
      writeText: (e) => s.call("clipboard.writeText", { text: e })
    },
    onDidChangeLanguage(e) {
      return s.on("host:language", (t) => {
        t && typeof t == "object" && "language" in t && typeof t.language == "string" && e(t.language);
      });
    }
  };
}, h = (s) => {
  const n = document.getElementById("root") ?? document.body;
  let i = () => {
  };
  const r = new Promise((o) => {
    i = o;
  });
  window.addEventListener("message", (o) => {
    if (o.source !== window.parent)
      return;
    const e = o.data;
    if (!e || e.type !== "mt-plugin:init" || e.protocol !== 1)
      return;
    const t = o.ports?.[0];
    t && i({ data: e, port: t });
  }), window.parent.postMessage({ type: "mt-plugin:hello", role: "panel" }, "*"), r.then(async ({ data: o, port: e }) => {
    const t = new p(e), a = f(t, o);
    try {
      await s(a, n), e.postMessage({ event: "activated", payload: {} });
    } catch (c) {
      const d = c instanceof Error ? c.message : String(c);
      e.postMessage({ event: "crash", payload: { message: d } });
    }
  });
}, b = (s) => {
  const n = s.trim();
  return n ? n.split(/\s+/).length : 0;
}, m = (s, n = !0) => {
  const i = n ? s : s.replace(/```[\s\S]*?```/g, " "), r = [];
  let o = { title: "Intro", words: 0 };
  for (const e of i.split(/\r?\n/)) {
    const t = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(e);
    t ? (r.push(o), o = { title: t[2], words: 0 }) : o.words += b(e);
  }
  return r.push(o), r.filter((e) => e.title !== "Intro" || e.words > 0);
}, g = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
h(async (s, n) => {
  const i = async () => {
    const r = await s.editor.getMarkdown(), o = await s.settings.get("countCode"), t = m(r ?? "", o !== !1).map(
      (a) => `<li class="word-counter-section" data-title="${g(a.title)}"><span class="title">${g(a.title)}</span><span class="count">${a.words}</span></li>`
    ).join("");
    n.innerHTML = `<h1>Word count</h1><ul class="word-counter-sections">${t}</ul>`;
  };
  await i(), await s.editor.onDidChangeContent(() => {
    i().catch(() => {
    });
  }), await s.editor.onDidSetContent(() => {
    i().catch(() => {
    });
  });
});
