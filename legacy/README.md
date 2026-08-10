# The pre-redesign site

Everything here was live until the Syde redesign replaced it. Nothing in this
directory is imported by the running app, and `tsconfig.json` excludes it, so it
does not compile or ship.

It is kept rather than deleted because the port was done page by page against
these files, and they are the only record of how some behaviour used to work.
`.grid` in `globals.css` is a good example of why that matters: it collided with
the Tailwind utility of the same name and cost a day to find.

- `*.tsx`, `globals.css`, `theme.css` — the old components and stylesheet.
- `prototype/` — the standalone Vite app the redesign was built in. Its source
  is the origin of most components now in `app/`. It has its own package.json;
  `npm i` inside it if you ever want to run it again.

Delete the lot once nothing here is worth consulting.
