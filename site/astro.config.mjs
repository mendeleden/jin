import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { siteUrl } from './src/lib/site-config.mjs';

export default defineConfig({
  site: siteUrl,
  integrations: [
    starlight({
      title: 'jin',
      description: 'The private data layer for AI coding teams.',
      logo: {
        src: './src/assets/jin-flowmark.png',
        alt: 'jin',
        replacesTitle: true,
      },
      customCss: ['./src/styles/theme.css'],
      favicon: '/favicon.svg',
      pagefind: false,
      credits: false,
      components: {
        ThemeProvider: './src/components/ForcedLightTheme.astro',
        ThemeSelect: './src/components/Noop.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/mendeleden/jin',
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'theme-color',
            content: '#f8f6f0',
          },
        },
      ],
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Overview', slug: 'docs' },
            { label: 'Install', slug: 'docs/guide/getting-started' },
            { label: 'Quick Start', slug: 'docs/guide/quick-start' },
          ],
        },
        {
          label: 'Team Rollout',
          items: [
            { label: 'Team Setup', slug: 'docs/guide/team-setup' },
            { label: 'Postgres', slug: 'docs/sinks/postgres' },
            { label: 'Webhook', slug: 'docs/sinks/webhook' },
            { label: 'S3 and R2', slug: 'docs/sinks/s3' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Adapters', slug: 'docs/reference/adapters' },
            { label: 'CLI', slug: 'docs/reference/cli' },
            { label: 'Configuration', slug: 'docs/reference/config' },
          ],
        },
      ],
    }),
  ],
});
