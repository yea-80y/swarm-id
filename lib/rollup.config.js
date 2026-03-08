import typescript from "@rollup/plugin-typescript"
import resolve from "@rollup/plugin-node-resolve"
import commonjs from "@rollup/plugin-commonjs"
import terser from "@rollup/plugin-terser"
import json from "@rollup/plugin-json"

const production = !process.env.ROLLUP_WATCH

// Shared TypeScript plugin configuration
const createTypeScriptPlugin = (options = {}) =>
  typescript({
    tsconfig: "./tsconfig.json",
    noEmitOnError: true,
    ...options,
  })

// Warning filter to suppress noisy third-party warnings
const onwarn = (warning, warn) => {
  // Skip circular dependency warnings from node_modules or external packages (bee-js, zod, etc.)
  if (
    warning.code === "CIRCULAR_DEPENDENCY" &&
    warning.ids?.some(
      (id) =>
        id.includes("node_modules") ||
        id.includes("/bee-js/") ||
        id.includes("/zod/"),
    )
  ) {
    return
  }
  // Skip missing export warnings for Node.js built-ins
  if (
    warning.code === "MISSING_EXPORT" &&
    warning.exporter?.includes("node-resolve:empty")
  ) {
    return
  }
  // Show all other warnings
  warn(warning)
}

const nodeBuiltins = [
  "tty",
  "util",
  "os",
  "stream",
  "path",
  "http",
  "https",
  "url",
  "fs",
  "assert",
  "zlib",
  "events",
  "net",
  "tls",
  "crypto",
  "buffer",
]

const sharedPlugins = (tsOptions = {}) => [
  resolve({ browser: true, preferBuiltins: false, skip: nodeBuiltins }),
  commonjs(),
  json(),
  createTypeScriptPlugin(tsOptions),
  production && terser(),
]

export default [
  // Full bundle (backward compat) — emits declarations for all entrypoints
  {
    input: "src/index.ts",
    output: {
      file: "dist/swarm-id.esm.js",
      format: "esm",
      sourcemap: true,
    },
    onwarn,
    plugins: sharedPlugins({
      declaration: true,
      declarationDir: "./dist",
      outDir: "./dist",
    }),
    external: [],
  },
  // Client-only bundle (lean — for dApps like WoCo)
  {
    input: "src/client.ts",
    output: {
      file: "dist/client.esm.js",
      format: "esm",
      sourcemap: true,
    },
    onwarn,
    plugins: sharedPlugins({ declaration: false, declarationMap: false }),
    external: [],
  },
  // Proxy-only bundle (heavy — for identity iframe)
  {
    input: "src/proxy-entry.ts",
    output: {
      file: "dist/proxy.esm.js",
      format: "esm",
      sourcemap: true,
    },
    onwarn,
    plugins: sharedPlugins({ declaration: false, declarationMap: false }),
    external: [],
  },
]
