import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'jin',
  description: 'Conversation data pipeline for agentic coding tools',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap', rel: 'stylesheet' }],
  ],
  themeConfig: {
    logo: undefined,
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Team Setup', link: '/guide/team-setup' },
      { text: 'GitHub', link: 'https://github.com/mendeleden/jin' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Installation', link: '/guide/getting-started' },
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Register Skills', link: '/guide/skills' },
        ]
      },
      {
        text: 'Team Setup',
        items: [
          { text: 'Overview', link: '/guide/team-setup' },
          { text: 'Self-Hosted Postgres', link: '/guide/postgres-self-hosted' },
          { text: 'Webhook Sink', link: '/guide/webhook' },
          { text: 'S3 / R2 Sink', link: '/guide/s3' },
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI Commands', link: '/guide/cli' },
          { text: 'Adapters', link: '/guide/adapters' },
          { text: 'Configuration', link: '/guide/config' },
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mendeleden/jin' }
    ],
    footer: {
      message: 'FSL-1.1-ALv2 — Fair Source License',
    }
  }
})
