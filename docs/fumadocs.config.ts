import { defineConfig } from 'fumadocs-core'
import { remarkInstall, remarkCodeTabs } from 'fumadocs-core/mdx-plugins'

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [
      remarkInstall,
      remarkCodeTabs,
    ],
  },
})
