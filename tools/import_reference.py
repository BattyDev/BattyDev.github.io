"""Convert gwent-classic's card table into our declarative card data.

Run once by hand; the output is committed and the source is not. Kept so the
provenance of every value is reproducible:

    git clone --depth 1 https://github.com/asundr/gwent-classic /tmp/gc
    python3 -I tools/import_reference.py /tmp/gc src/classic/data

gwent-classic (MIT + Commons Clause, Arun Sundaram) is a faithful browser
remake of the Witcher 3 minigame. Its numbers are cross-checked against the
game in test/data and docs/VERIFY.md; anything we deliberately differ on is an
override below, with the reason next to it.
"""

import json
import re
import sys
from pathlib import Path

FACTIONS = {
    "realms": "realms",
    "nilfgaard": "nilfgaard",
    "monsters": "monsters",
    "scoiatael": "scoiatael",
    "skellige": "skellige",
    "neutral": "neutral",
    "special": "neutral",
    "weather": "neutral",
}

ROWS = {
    "close": ["close"],
    "ranged": ["ranged"],
    "siege": ["siege"],
    "agile": ["close", "ranged"],
}

UNIT_ABILITIES = {
    "medic": "medic",
    "spy": "spy",
    "muster": "muster",
    "bond": "bond",
    "morale": "morale",
    "horn": "horn",
    "scorch": "scorch",
    "scorch_c": "scorch_close",
    "scorch_r": "scorch_ranged",
    "scorch_s": "scorch_siege",
    "avenger": "avenger",
    "avenger_kambi": "avenger",
    "berserker": "berserker",
    "mardroeme": "mardroeme",
}

SPECIAL_EFFECTS = {"decoy", "horn", "scorch", "mardroeme"}
WEATHER_EFFECTS = {"frost": "frost", "fog": "fog", "rain": "rain", "clear": "clear", "storm": "storm"}

# Display names the source abbreviates or pads.
NAME_FIXES = {
    "Arachas ": "Arachas",
    "Arachas- Behemoth": "Arachas Behemoth",
}

# Muster: which group a card belongs to, and which group it pulls when played.
# Explicit rather than derived from names so that "Cerys" pulling her shield
# maidens, or Geralt pulling Roach, is visible in the data.
MUSTER = {
    # filename prefix -> (group, pulls)
    "arachas": ("arachas", "arachas"),
    "witch_velen": ("crone", "crone"),
    "ghoul": ("ghoul", "ghoul"),
    "nekker": ("nekker", "nekker"),
    "bruxa": ("vampire", "vampire"),
    "ekkima": ("vampire", "vampire"),
    "fleder": ("vampire", "vampire"),
    "garkain": ("vampire", "vampire"),
    "katakan": ("vampire", "vampire"),
    "dwarf": ("dwarven_skirmisher", "dwarven_skirmisher"),
    "elf_skirmisher": ("elven_skirmisher", "elven_skirmisher"),
    "havekar_support": ("havekar_smuggler", "havekar_smuggler"),
    "light_longship": ("light_longship", "light_longship"),
    "gaunter_odimm": ("gaunter", "gaunter"),
    "cerys": (None, "shield_maiden"),
    "shield_maiden": ("shield_maiden", None),
    "geralt": (None, "roach"),
    "ciri": (None, "roach"),
    "roach": ("roach", None),
}

# Avenger and Berserker summon a token card; the source wires these by index.
SUMMONS = {
    "cow": "neutral.chort",
    "kambi": "skellige.hemdall",
    "berserker": "skellige.vildkaarl",
    "young_berserker": "skellige.young_vildkaarl",
}

TOKENS = {"chort", "hemdall", "vildkaarl", "young_vildkaarl"}

# Only claims we are sure of. Everything else has no "set" rather than a guess.
SETS = {"skellige": "blood_and_wine", "roach": "next_gen"}


def muster_entry(filename):
    for prefix, value in MUSTER.items():
        if filename == prefix or filename.startswith(prefix + "_") or filename.startswith(prefix):
            return value
    return None


def convert(raw):
    name = NAME_FIXES.get(raw["name"], raw["name"]).strip()
    filename = raw["filename"]
    faction = FACTIONS[raw["deck"]]
    tags = raw["ability"].split()
    card = {"id": f"{faction}.{filename}", "name": name, "faction": faction}

    if raw["row"] == "leader":
        card["type"] = "leader"
        card["leader"] = tags[0]
        card["copies"] = 1
    elif raw["deck"] == "weather":
        card["type"] = "weather"
        card["effect"] = WEATHER_EFFECTS[tags[0]]
        card["copies"] = int(raw["count"])
    elif raw["deck"] == "special":
        card["type"] = "special"
        assert tags[0] in SPECIAL_EFFECTS, tags
        card["effect"] = tags[0]
        card["copies"] = int(raw["count"])
    else:
        card["type"] = "unit"
        card["rows"] = ROWS[raw["row"]]
        card["strength"] = int(raw["strength"])
        card["hero"] = "hero" in tags
        abilities = []
        for t in tags:
            if t in ("hero", "vildkarrl"):
                continue
            abilities.append(UNIT_ABILITIES[t])
        card["abilities"] = abilities
        m = muster_entry(filename)
        if m:
            group, pulls = m
            if group:
                card["group"] = group
            if pulls and "muster" in abilities:
                card["musterPulls"] = pulls
        if "muster" in abilities and "musterPulls" not in card:
            raise SystemExit(f"muster card without a group: {filename}")
        if filename in SUMMONS:
            card["summons"] = SUMMONS[filename]
        if filename in TOKENS:
            card["token"] = True
            card["copies"] = 0
        else:
            card["copies"] = int(raw["count"])

    if raw["deck"] in SETS:
        card["set"] = SETS[raw["deck"]]
    if filename in SETS:
        card["set"] = SETS[filename]
    card["art"] = art_name(raw)
    return card


def art_name(raw):
    # Source images are "<deck>_<filename>.jpg" for faction cards and
    # "<deck>_<filename>" with deck in {special, weather, neutral} otherwise.
    return f"{raw['deck']}_{raw['filename']}"


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    text = (src / "cards.js").read_text(encoding="utf-8")
    entries = re.findall(r"\{ \"name[^}]*\}", text)
    raws = [json.loads(e.replace("\\'", "'")) for e in entries]
    cards = [convert(r) for r in raws]

    # Multi-art cards (ballista/ballista_1, arachas/arachas_1, ...) are
    # separate collectible cards in the game, so ids must stay distinct.
    ids = [c["id"] for c in cards]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"duplicate ids: {sorted(dupes)}")

    (out / "cards.json").write_text(json.dumps(cards, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    # Starter decks, re-keyed from source indices to our ids.
    decks_text = (src / "decks.js").read_text(encoding="utf-8")
    decks = []
    for d in re.findall(r"'(\{.*?\})'", decks_text):
        deck = json.loads(d)
        decks.append({
            "faction": deck["faction"],
            "leader": cards[deck["leader"]]["id"],
            "cards": [[cards[i]["id"], n] for i, n in deck["cards"]],
        })
    (out / "starter-decks.json").write_text(json.dumps(decks, indent=1) + "\n", encoding="utf-8")
    print(f"{len(cards)} cards, {len(decks)} starter decks")


if __name__ == "__main__":
    main()
