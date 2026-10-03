import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Une seule application web, trois interfaces :
//   /         -> menu client   (src/client)
//   /caisse/  -> caisse        (src/caisse)
//   /admin/   -> dashboard     (src/admin)
//   /login    -> écran de connexion commun (même application que /admin/)
const APPS = ["client", "caisse", "admin"] as const;

/**
 * Chaque interface garde son propre code et ses propres composants : "@/..." pointe vers
 * src/<interface>/... selon le fichier qui fait l'import.
 */
function perAppAlias(): Plugin {
  return {
    name: "per-app-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/") || !importer) return null;
      const match = importer.replace(/\\/g, "/").match(/\/src\/(client|caisse|admin)\//);
      if (!match) return null;
      const target = path.resolve(__dirname, "src", match[1], source.slice(2));
      return this.resolve(target, importer, { ...options, skipSelf: true });
    },
  };
}

// Serveur Node (API, images, temps réel). En production c'est lui qui sert ces pages.
const SERVER = process.env.VITE_SERVER_URL || "http://localhost:3001";

/** En développement, /login ouvre la page de l'admin (en production c'est le serveur Node qui s'en charge) */
function loginRoute(): Plugin {
  return {
    name: "login-route",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/login\/?(\?|#|$)/.test(req.url)) req.url = "/admin/index.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [perAppAlias(), loginRoute(), react()],
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": SERVER,
      "/images": SERVER,
      "/socket.io": { target: SERVER, ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        APPS.map((app) => [app, path.resolve(__dirname, app === "client" ? "index.html" : `${app}/index.html`)])
      ),
    },
  },
});
