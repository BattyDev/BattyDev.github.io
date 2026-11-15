# Ribbon Survivors

Play at https://battydev.com/ribbon/ on desktop or phone.

Guide Lumina through the Roseglass Cloister, Moonwater Gallery and Astral Observatory. Her wand targets nearby enemies automatically. Move through cyan crystals to earn blessings, then face the Eclipse Moth in the final court.

## Play

Use WASD or the arrow keys to move. On a touch screen, drag the circular stick. Choose a blessing by tapping a card or pressing 1, 2 or 3. Escape or the pause button pauses the game. Returning from another window or rotating the screen requires an explicit resume. The sound button enables optional synthesized wand and menu tones.

The courts last 90, 120 and 180 seconds. At each transition, Lumina collects the remaining crystal value and chooses any earned blessings. After a boss victory, retire or continue with the same build and health into a harder cycle. Restart begins a fresh run.

## Run locally

Use Node.js 20 or newer. Run `npm start` and open [the local game](http://localhost:4173). Run `npm test` for the simulation regressions. The game runs directly from static HTML, CSS, JavaScript modules and four local illustrated sprites.

The world uses continuous ground coordinates in a 96-unit square. The following perspective camera projects terrain, architecture, shadows, effects and characters into the canvas. Mobile and desktop use the same fixed-step combat simulation.

Append `?quick=1` for 8, 10 and 12 second courts and a smaller boss health pool. Append `?test=1` to expose `window.__game` with a live `state` getter, `advanceStage()`, `gainXP(n)`, `damage(n)`, `defeatBoss()` and `worldToScreen(x,z,height)`. Combine both flags with `?quick=1&test=1`.
