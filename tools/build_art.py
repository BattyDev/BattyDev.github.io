"""Convert official Witcher 3 Gwent art into the WebP set the app serves.

    python3 -I tools/build_art.py <gwent-classic checkout> public/art

Card art (img/sm, the illustration without a frame) becomes art/sm/<art>.webp
for the board and hand; the full framed card (img/lg) becomes
art/lg/<art>.webp for the zoom view. A handful of the game's UI icons come
across too. Needs ImageMagick with WebP support.

The art is CD PROJEKT RED's, used under their fan content guidelines; see
NOTICE.md. It is committed so the site builds without the source checkout.
"""

import subprocess
import sys
from pathlib import Path

SM_WIDTH = 200   # board/hand tiles are ~100 CSS px wide; 2x for HiDPI
LG_WIDTH = 410   # source resolution; zoom shows it near 1:1
QUALITY = "78"

ICONS = [
    "card_ability_agile", "card_ability_avenger", "card_ability_berserker",
    "card_ability_bond", "card_ability_decoy", "card_ability_horn",
    "card_ability_mardroeme", "card_ability_medic", "card_ability_morale",
    "card_ability_muster", "card_ability_scorch", "card_ability_spy",
    "card_row_agile", "card_row_close", "card_row_ranged", "card_row_siege",
    "card_weather_fog", "card_weather_frost", "card_weather_rain", "card_weather_storm",
    "card_special_horn", "card_special_mardroeme",
    "power_normal", "power_hero",
    "icon_gem_on", "icon_gem_off", "icon_leader_active",
    "overlay_fog", "overlay_frost", "overlay_rain",
    "deck_back_realms", "deck_back_nilfgaard", "deck_back_monsters",
    "deck_back_scoiatael", "deck_back_skellige",
    "deck_shield_realms", "deck_shield_nilfgaard", "deck_shield_monsters",
    "deck_shield_scoiatael", "deck_shield_skellige",
]


def webp(src: Path, dst: Path, width: int | None):
    dst.parent.mkdir(parents=True, exist_ok=True)
    args = ["convert", str(src), "-strip"]
    if width:
        args += ["-resize", f"{width}x>"]
    args += ["-quality", QUALITY, "-define", "webp:method=6", str(dst)]
    subprocess.run(args, check=True)


def main():
    src = Path(sys.argv[1]) / "img"
    out = Path(sys.argv[2])
    n = 0
    for f in sorted((src / "sm").glob("*.jpg")):
        webp(f, out / "sm" / (f.stem + ".webp"), SM_WIDTH)
        n += 1
    for f in sorted((src / "lg").glob("*.jpg")):
        webp(f, out / "lg" / (f.stem + ".webp"), LG_WIDTH)
        n += 1
    icons = src / "icons"
    for name in ICONS:
        f = next(icons.glob(name + ".*"))
        webp(f, out / "icons" / (name + ".webp"), None)
        n += 1
    print(f"{n} images written to {out}")


if __name__ == "__main__":
    main()
