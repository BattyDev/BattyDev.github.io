# Dungeon Delve MVP deployment

This snapshot publishes the MVP at `https://battydev.com/DungeonDelve/`. This directory is the compiled static output of the separate `BattyDev/DungeonDelver` project. It uses billboarded 2D adventurers and creatures in a Three.js world, with deterministic rules and local-only saves.

The source is published in `BattyDev/DungeonDelver`. This first release is copied here as a compiled static snapshot. This follows the domain repo's existing no-build convention; its Pages workflow publishes the directory with the rest of the site.

To update the snapshot:

1. In DungeonDelver, run its tests and strict typecheck, then `DELVER_BASE_PATH=/DungeonDelve/ pnpm build`.
2. Replace this repo's `DungeonDelve/` directory with `apps/client/dist/` from that build. Remove old hashed assets when replacing it.
3. Verify the game at this exact subpath, including assets, class creation, recruiting and entering the dungeon.
4. Commit on a branch, open a PR, and merge it to trigger the domain's existing Pages deployment.

The build uses content-hashed CSS/JS URLs for cache invalidation. No changes to the site's CNAME, existing projects or homepage are required.
