# Contributing to VOT UZ

Thank you for your interest in improving VOT UZ! Contributions from the community are warmly welcome.

## Development Setup

1. **Prerequisites:**
   - Node.js (version 18 or higher)
   - npm or pnpm

2. **Clone and Install:**
   ```bash
   git clone https://github.com/abdurazzoqo/vot-uz.git
   cd vot-uz
   npm install
   ```

3. **Development Mode:**
   ```bash
   npm run dev
   ```
   Load the temporary unpacked extension from `.output/chrome-mv3` in `chrome://extensions/`.

4. **Testing and Verification:**
   Before submitting code, ensure all checks pass:
   ```bash
   npm test
   npm run typecheck
   npm run build
   ```

## Pull Request Guidelines

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Keep commits concise and meaningful.
3. Add unit tests for any new logic or bug fixes.
4. Open a pull request against the `main` branch with a clear description of your changes.
