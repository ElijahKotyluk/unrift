import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://unrift.pages.dev",
  integrations: [
    starlight({
      title: "UNRIFT",
      description:
        "A lightweight, fast TypeScript test framework with ESM-first design.",
      logo: {
        src: "./src/assets/header-logo.png",
        alt: "",
      },
      favicon: "/favicon-32x32.png",
      head: [
        { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" } },
        { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" } },
      ],
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/ElijahKotyluk/unrift",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/ElijahKotyluk/unrift/edit/main/packages/docs/",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
          ],
        },
        {
          label: "Guide",
          items: [
            { label: "Configuration", slug: "guide/configuration" },
            { label: "CLI", slug: "guide/cli" },
            { label: "Custom Matchers", slug: "guide/custom-matchers" },
            { label: "Async Testing", slug: "guide/async-testing" },
            { label: "Migrating from Jest", slug: "guide/migrating-from-jest" },
          ],
        },
        {
          label: "API Reference",
          items: [
            { label: "Matchers", slug: "reference/matchers" },
            { label: "Hooks", slug: "reference/hooks" },
            { label: "Modifiers", slug: "reference/modifiers" },
            { label: "Spies and Mocks", slug: "reference/spies-and-mocks" },
            { label: "Request Mocking", slug: "reference/request-mocking" },
            { label: "Timers and Dates", slug: "reference/timers-and-dates" },
            { label: "File System Mocking", slug: "reference/file-system-mocking" },
            { label: "Module Mocking", slug: "reference/module-mocking" },
            { label: "Programmatic API", slug: "reference/programmatic-api" },
          ],
        },
      ],
    }),
  ],
});
