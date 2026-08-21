import { defineConfig } from 'i18next-cli';

// Foundation PR (see docs/i18n.md): only `common` and `auth` exist so far,
// covering src/features/auth/** and src/features/layout/**. The extract/lint
// input glob is deliberately scoped to those two folders rather than all of
// src/** — the other ~25 feature folders (~200 files) still have hardcoded
// English strings by design (see plan §14) and aren't ready to be linted
// until their own follow-up PR adds a namespace for them. Each follow-up PR
// should widen this glob to include the folder(s) it migrates.
//
// Note: src/features/settings/sections/PreferencesSection.tsx and
// src/components/LanguageSync.tsx were also touched by this PR (the language
// selector row / server-sync component), but deliberately excluded here —
// they're `settings` namespace territory (deferred, see docs/i18n.md's
// Roadmap), and PreferencesSection.tsx has plenty of *other* pre-existing
// hardcoded strings unrelated to language selection that aren't this PR's
// job to migrate. Including them would make the linter demand a full-file
// migration neither this PR nor its scope calls for.
export default defineConfig({
  locales: ['en', 'nb'],
  extract: {
    input: [
      'src/features/auth/**/*.{ts,tsx}',
      'src/features/layout/**/*.{ts,tsx}',
    ],
    ignore: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    output: 'src/locales/{{language}}/{{namespace}}.json',
    primaryLanguage: 'en',
    secondaryLanguages: ['nb'],
  },
});
