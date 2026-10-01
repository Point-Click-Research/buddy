/// <reference types="electron-vite/node" />

declare module '*?raw' {
  const content: string;
  export default content;
}

// Build-time configuration electron-vite bakes into the main process from
// .env, which is not in the repo. All optional: a build without them has no
// Buddy account and runs on the user's own keys. The values for an official
// build are written down in the private buddy-cloud repo.
interface ImportMetaEnv {
  readonly MAIN_VITE_BUDDY_API_URL?: string;
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_ANON_KEY?: string;
}
