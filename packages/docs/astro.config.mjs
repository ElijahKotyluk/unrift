import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://unrift.pages.dev",
  integrations: [
    starlight({
      title: "Unrift",
      description:
        "A lightweight, fast TypeScript test framework with ESM-first design.",
      logo: {
        src: "./src/assets/header-logo.png",
        alt: "Unrift",
      },
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
            { label: "Programmatic API", slug: "reference/programmatic-api" },
          ],
        },
      ],
    }),
  ],
});
