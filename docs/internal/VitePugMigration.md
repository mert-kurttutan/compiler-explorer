# Vite / Pug Migration Note

- Server-side Pug is still in use for Express views under `views/`.
- The client-side `.pug` imports for the privacy policy, cookie policy, and changelog are the bit that blocks a clean Vite move.
- Webpack only needed a Pug loader for those client imports; once the documents are injected from the server bootstrap, that loader can go away without removing the `pug` package.
