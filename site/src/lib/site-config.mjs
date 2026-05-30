const defaultSiteUrl = 'https://jin.builtbyeden.app';
const configuredSiteUrl = globalThis.process?.env?.PUBLIC_JIN_SITE_URL || defaultSiteUrl;

export const siteUrl = configuredSiteUrl.replace(/\/$/, '');

export const installCommands = {
  unix: `curl -fsSL ${siteUrl}/install.sh | sh`,
  windows: `irm ${siteUrl}/install.ps1 | iex`,
};
