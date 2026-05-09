import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Bonita',
  description: 'A calm reading overlay for dense web content.',
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
    128: 'public/logo-128.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
      128: 'public/logo-128.png',
    },
    default_popup: 'src/popup/index.html',
  },
  permissions: [
    'sidePanel',
    'contentSettings',
    'storage',
  ],
  content_scripts: [{
    js: ['src/content/main.tsx'],
    matches: ['http://*/*', 'https://*/*'],
  }],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  web_accessible_resources: [
    {
      resources: ['fonts/*'],
      matches: ['http://*/*', 'https://*/*'],
    },
  ],
})
