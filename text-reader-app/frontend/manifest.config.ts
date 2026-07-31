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
    'contentSettings',
    'storage',
  ],
  // Required so the background worker's fetch() calls to these APIs bypass
  // page-level CORS/CSP — content scripts can't do this on their own since
  // they run inside the page's origin.
  host_permissions: [
    'https://api.datamuse.com/*',
    'https://api.dictionaryapi.dev/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [{
    js: ['src/content/main.tsx'],
    matches: ['http://*/*', 'https://*/*'],
  }],
  web_accessible_resources: [
    {
      resources: ['fonts/*'],
      matches: ['http://*/*', 'https://*/*'],
    },
  ],
})