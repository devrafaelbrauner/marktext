const f = (s, n) => Object.assign(new Error(n), { code: s });
class h {
  port;
  seq = 1;
  pending = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Map();
  reverse = /* @__PURE__ */ new Map();
  constructor(n) {
    this.port = n, n.addEventListener("message", (o) => {
      this.onMessage(o.data);
    }), n.start();
  }
  call(n, o) {
    const r = this.seq++;
    let i = () => {
    }, e = () => {
    };
    const t = new Promise((a, c) => {
      i = a, e = c;
    });
    return this.pending.set(r, { resolve: i, reject: e }), this.port.postMessage({ id: r, method: n, args: o === void 0 ? [] : [o] }), t;
  }
  on(n, o) {
    const r = this.listeners.get(n) ?? /* @__PURE__ */ new Set();
    return r.add(o), this.listeners.set(n, r), { dispose: () => r.delete(o) };
  }
  handle(n, o) {
    this.reverse.set(n, o);
  }
  async onMessage(n) {
    if (!(!n || typeof n != "object")) {
      if ("ok" in n && "id" in n && typeof n.id == "number") {
        const o = this.pending.get(n.id);
        if (this.pending.delete(n.id), !o)
          return;
        if (n.ok === !0)
          o.resolve("value" in n ? n.value : void 0);
        else {
          const r = "error" in n && n.error && typeof n.error == "object" ? n.error : null, i = r && "code" in r && typeof r.code == "string" ? r.code : "FAILED", e = r && "message" in r && typeof r.message == "string" ? r.message : "RPC failed";
          o.reject(f(i, e));
        }
        return;
      }
      if ("method" in n && "id" in n && typeof n.method == "string" && typeof n.id == "string") {
        const o = "args" in n && Array.isArray(n.args) ? n.args : [], r = this.reverse.get(n.method);
        try {
          const i = r ? await r(o) : void 0;
          this.port.postMessage({ id: n.id, ok: !0, value: i });
        } catch (i) {
          const e = i instanceof Error ? i.message : String(i);
          this.port.postMessage({ id: n.id, ok: !1, error: { code: "FAILED", message: e } });
        }
        return;
      }
      if ("event" in n && typeof n.event == "string") {
        const o = "payload" in n ? n.payload : void 0;
        for (const r of this.listeners.get(n.event) ?? [])
          r(o);
      }
    }
  }
}
const d = async (s, n, o, r) => {
  const i = await s.call(n, {}), e = s.on(o, r);
  return {
    dispose() {
      e.dispose(), s.call("dispose", { handle: i.handle });
    }
  };
}, p = (s, n) => {
  let o = n.language;
  const r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
  return s.handle("command.run", async (e) => {
    const t = e[0], a = t && typeof t == "object" && "id" in t && typeof t.id == "string" ? t.id : "", c = r.get(a);
    if (!c)
      throw new Error(`Unknown command ${a}`);
    await c();
  }), s.handle("codeblock.render", async (e) => {
    const t = e[0];
    if (!t || typeof t != "object" || !("token" in t))
      return "";
    const a = typeof t.token == "string" ? i.get(t.token) : void 0;
    if (!a)
      return "";
    const c = "source" in t && typeof t.source == "string" ? t.source : "", l = "lang" in t && typeof t.lang == "string" ? t.lang : "";
    return a.render({ source: c, lang: l });
  }), s.handle("codeblock.exportHtml", async (e) => {
    const t = e[0];
    if (!t || typeof t != "object" || !("token" in t) || typeof t.token != "string")
      return "";
    const a = i.get(t.token);
    if (!a?.exportHtml)
      return "";
    const c = "source" in t && typeof t.source == "string" ? t.source : "", l = "lang" in t && typeof t.lang == "string" ? t.lang : "";
    return a.exportHtml(c, l);
  }), s.on("host:language", (e) => {
    e && typeof e == "object" && "language" in e && typeof e.language == "string" && (o = e.language);
  }), {
    manifest: n.manifest,
    get language() {
      return o;
    },
    settings: {
      get: (e) => s.call("settings.get", { key: e }),
      set: (e, t) => s.call("settings.set", { key: e, value: t }),
      onDidChange: (e) => d(s, "settings.subscribe", "settings:change", (t) => {
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
      onDidChangeContent: (e) => d(s, "editor.subscribeContent", "editor:content-change", e),
      onDidChangeActiveTab: (e) => d(s, "editor.subscribeActiveTab", "editor:active-tab", e),
      onDidSetContent: (e) => d(s, "editor.subscribeSetContent", "editor:set-content", e),
      insertText: (e) => s.call("editor.insertText", { text: e }),
      replaceRange: (e) => s.call("editor.replaceRange", e),
      setDecorations: (e, t) => s.call("editor.setDecorations", { layerId: e, ranges: t }),
      clearDecorations: (e) => s.call("editor.clearDecorations", { layerId: e }),
      onDidClickDecoration: (e, t) => d(s, "editor.subscribeDecorationClick", "editor:decoration-click", (a) => {
        a && typeof a == "object" && "layerId" in a && a.layerId === e && t(a);
      }),
      registerCodeBlockRenderer: async (e) => {
        const t = await s.call("editor.registerCodeBlockRenderer", {
          lang: e.lang,
          debounceMs: e.debounceMs
        });
        return i.set(t.handle, e), {
          dispose() {
            i.delete(t.handle), s.call("dispose", { handle: t.handle });
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
      subscribe: (e) => d(s, "metadata.subscribe", "metadata:change", (t) => {
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
}, b = (s) => {
  window.parent.postMessage({ type: "mt-plugin:crash", message: s }, "*");
}, w = (s) => {
  const n = globalThis;
  n.__MT_PLUGIN_DEFINITION__ = {
    kind: "background",
    async start(o, r) {
      const i = new h(r), e = p(i, o);
      window.addEventListener("error", (t) => {
        r.postMessage({ event: "crash", payload: { message: t.message } });
      }), window.addEventListener("unhandledrejection", (t) => {
        const a = t.reason, c = a instanceof Error ? a.message : String(a);
        r.postMessage({ event: "crash", payload: { message: c } });
      }), i.on("host:shutdown", () => {
        s.deactivate?.();
      });
      try {
        await s.activate(e), r.postMessage({ event: "activated", payload: {} });
      } catch (t) {
        const a = t instanceof Error ? t.message : String(t);
        throw r.postMessage({ event: "crash", payload: { message: a } }), b(a), t;
      }
    }
  };
}, v = (s) => {
  const n = s.trim();
  return n ? n.split(/\s+/).length : 0;
}, g = (s, n = !0) => {
  const o = n ? s : s.replace(/```[\s\S]*?```/g, " "), r = [];
  let i = { title: "Intro", words: 0 };
  for (const e of o.split(/\r?\n/)) {
    const t = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(e);
    t ? (r.push(i), i = { title: t[2], words: 0 }) : i.words += v(e);
  }
  return r.push(i), r.filter((e) => e.title !== "Intro" || e.words > 0);
}, u = (s) => s.reduce((n, o) => n + o.words, 0);
w({
  async activate(s) {
    await s.commands.register({
      id: "word-counter.count",
      title: "Count words in sections",
      async run() {
        const n = await s.editor.getMarkdown(), o = await s.settings.get("countCode"), r = g(n ?? "", o !== !1);
        await s.notify({ message: `Counted ${u(r)} words`, type: "info" });
      }
    }), await s.editor.registerCodeBlockRenderer({
      lang: ["wordcount"],
      render({ source: n }) {
        return `<p class="wordcount-preview">Words: ${u(g(n, !0))}</p>`;
      }
    });
  }
});
