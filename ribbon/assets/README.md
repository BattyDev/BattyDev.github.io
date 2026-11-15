# Character billboards

## Assets and prompt summaries

- `lumina.png` — Lumina, a full-body magical girl in an ivory-and-gold dress and cape, with blush-pink hair, a star bow, and a wand held to her right. Three-quarter rear pose looking back, elevated orthographic view.
- `moth.png` — A compact flying moth enemy with a deep-purple segmented body, glowing pink-violet eyes, antennae, hooked feet, and wide jagged plum wings with inset lavender moon marks. Front three-quarter view.
- `knight.png` — A full-body crescent golem in near-black navy angular armor, with a crescent crest, violet and crimson inset seams, and a dark mantle. Strong three-quarter silhouette; no weapon.
- `boss.png` — Eclipse Moth, a full-body ivory-and-lavender moth witch with a gold crescent crown, violet eyes, feathery antennae, and broad wings with large eye-spots and moon marks. Elevated front three-quarter view.

Prompt set: each image was requested as one centered, polished cel-shaded 3D game-character cutout, with crisp edges, controlled highlights, readable silhouette, and the named character-specific palette and details above. Each used an orthographic elevated camera and a transparent canvas with generous margins. Backgrounds, floors, cast shadows, text, logos, borders, UI, extra characters, and cropped limbs were excluded. The moth and boss prompts also explicitly excluded backdrops, gradients, vignettes, fog, halos, and light spill outside the subject.

## Generation and alpha check

Generated with the built-in `image_gen` tool using `transparent_background=true`; no CLI or API fallback was used. The moth and boss borders were checked beyond their corners, along with sampled areas outside each silhouette. The sampled outside areas have alpha 0. Nonzero border pixels are only faint edge antialiasing: moth maximum alpha 1; boss maximum alpha 23. `view_image` may show RGB values stored beneath fully transparent pixels; the PNG alpha channel controls what the renderer displays.

The browser release serves optimized `.webp` delivery copies. Original `.png` files remain in the local project as source artwork.
