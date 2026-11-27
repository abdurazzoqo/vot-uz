import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'VOT Uzbek - YouTube Ovozli Tarjima',
    description: 'YouTube videolarini o\'zbek tiliga sun\'iy ovoz bilan real vaqtda tarjima qilish',
    version: '1.0.0',
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    },
    action: {
      default_title: 'VOT UZ - YouTube Ovozli Tarjimoni',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png'
      }
    },
    permissions: ['storage', 'offscreen'],
    host_permissions: [
      '*://*.youtube.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://huggingface.co/*'
    ],
    options_ui: {
      page: 'options.html',
      open_in_tab: true
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
    }
  }
});
