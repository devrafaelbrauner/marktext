package app.marktextplus.android;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PluginFileServerTest {

    private static final String CSP = "default-src 'none'; script-src 'unsafe-inline' https://word-counter.plugin.local";

    @Rule
    public TemporaryFolder temp = new TemporaryFolder();

    private File filesDir;
    private PluginFileServer server;

    @Before
    public void setUp() throws IOException {
        filesDir = temp.newFolder("files");
        write("plugins/word-counter/main.js", "export {}");
        write("plugins/word-counter/panel.html", "<p>panel</p>");
        write("plugins/word-counter/assets/icon.png", "png");
        write("plugins/word-counter/__mt/bootstrap.js", "plugin-provided, never served");
        write("plugin-host/word-counter/csp.txt", CSP + "\n");
        write("plugin-host/word-counter/bootstrap.html", "<script type=\"module\"></script>");
        write("plugin-host/word-counter/bootstrap.js", "const MAIN = \"main.js\"");
        write("plugins/disabled/main.js", "export {}");
        write("secret.txt", "secret");
        server = new PluginFileServer(filesDir);
    }

    private void write(String relative, String content) throws IOException {
        File file = new File(filesDir, relative);
        file.getParentFile().mkdirs();
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String body(PluginFileServer.Response response) {
        return new String(response.body, StandardCharsets.UTF_8);
    }

    @Test
    public void servesPluginFilesWithTypeAndThePluginCsp() {
        PluginFileServer.Response js = server.serve("word-counter.plugin.local", "/main.js");
        assertEquals(200, js.status);
        assertEquals("text/javascript", js.mimeType);
        assertEquals("utf-8", js.charset);
        assertEquals("export {}", body(js));
        assertEquals(CSP, js.headers.get("Content-Security-Policy"));
        assertEquals("nosniff", js.headers.get("X-Content-Type-Options"));
        assertEquals("*", js.headers.get("Access-Control-Allow-Origin"));

        PluginFileServer.Response png = server.serve("Word-Counter.plugin.local", "/assets/icon.png");
        assertEquals(200, png.status);
        assertEquals("image/png", png.mimeType);
        assertNull(png.charset);
        assertEquals("text/html", server.serve("word-counter.plugin.local", "/panel.html").mimeType);
    }

    @Test
    public void servesHostDocumentsFromPluginHostNotFromThePlugin() {
        PluginFileServer.Response html = server.serve("word-counter.plugin.local", "/__mt/bootstrap.html");
        assertEquals(200, html.status);
        assertEquals("text/html", html.mimeType);
        PluginFileServer.Response js = server.serve("word-counter.plugin.local", "/__mt/bootstrap.js");
        assertEquals("const MAIN = \"main.js\"", body(js));
        assertEquals(404, server.serve("word-counter.plugin.local", "/__mt/other.js").status);
        assertEquals(404, server.serve("word-counter.plugin.local", "/__mt").status);
    }

    @Test
    public void ignoresOtherHosts() {
        assertNull(server.serve("vault.local", "/x"));
        assertNull(server.serve("localhost", "/index.html"));
        assertNull(server.serve("plugin.local.evil.com", "/main.js"));
        assertNull(server.serve(null, "/main.js"));
    }

    @Test
    public void refusesDisabledPluginsAndInvalidIds() {
        PluginFileServer.Response disabled = server.serve("disabled.plugin.local", "/main.js");
        assertEquals(403, disabled.status);
        assertEquals("default-src 'none'", disabled.headers.get("Content-Security-Policy"));
        assertEquals(404, server.serve("-bad.plugin.local", "/main.js").status);
        assertEquals(404, server.serve("a.b.plugin.local", "/main.js").status);
        assertEquals(404, server.serve(".plugin.local", "/main.js").status);
    }

    @Test
    public void rejectsTraversalInEveryEncoding() {
        String[] paths = {
            "/../secret.txt",
            "/../../secret.txt",
            "/%2e%2e/%2e%2e/secret.txt",
            "/%2e%2e%2f%2e%2e%2fsecret.txt",
            "/assets/..%2f..%2f..%2fsecret.txt",
            "/..%5c..%5csecret.txt",
            "/main.js%00.png",
            "/a//b",
            "/./main.js",
            "/",
            "",
            "/%zz",
            "/%c3%28"
        };
        for (String path : paths) {
            PluginFileServer.Response response = server.serve("word-counter.plugin.local", path);
            assertEquals(path, 400, response.status);
        }
        assertNull(PluginFileServer.safeRelativePath("/%2e%2e%2fsecret.txt"));
        assertEquals("a b/c+d.js", PluginFileServer.safeRelativePath("/a%20b/c+d.js"));
    }

    @Test
    public void rejectsSymlinksLeavingThePlugin() throws IOException {
        File plugin = new File(filesDir, "plugins/word-counter");
        Files.createSymbolicLink(new File(plugin, "escape.txt").toPath(), new File(filesDir, "secret.txt").toPath());
        Files.createSymbolicLink(new File(plugin, "inside.js").toPath(), new File(plugin, "main.js").toPath());
        assertEquals(404, server.serve("word-counter.plugin.local", "/escape.txt").status);
        assertNull(PluginFileServer.resolvePluginFile(plugin, "escape.txt"));
        assertNotNull(PluginFileServer.resolvePluginFile(plugin, "inside.js"));

        File linkedRoot = new File(filesDir, "plugins/linked");
        Files.createSymbolicLink(linkedRoot.toPath(), plugin.toPath());
        assertNull(PluginFileServer.resolvePluginFile(linkedRoot, "main.js"));
    }

    @Test
    public void reportsMissingAndOversizedFiles() throws IOException {
        assertEquals(404, server.serve("word-counter.plugin.local", "/missing.js").status);
        assertEquals(404, server.serve("word-counter.plugin.local", "/assets").status);
        byte[] big = new byte[(int) PluginFileServer.MAX_FILE_BYTES + 1];
        Files.write(new File(filesDir, "plugins/word-counter/big.bin").toPath(), big);
        assertEquals(413, server.serve("word-counter.plugin.local", "/big.bin").status);
        assertArrayEquals("export {}".getBytes(StandardCharsets.UTF_8), server.serve("word-counter.plugin.local", "/main.js").body);
    }
}
