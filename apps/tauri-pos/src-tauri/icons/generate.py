#!/usr/bin/env python3
"""
Norns POS — Erzeuger der Anwendungssymbole.

Das Zeichen von Norns, in der Form von Basels Anweisung vom 19.08.2026:
zwei Stämme in Tinte, und der weinrote Faden IST die Schräge des N — von
der Spitze des linken Stamms zum Fuss des rechten. Die Nornen spinnen den
Faden, und der Faden trägt den Buchstaben.

Vorher lag der Faden QUER über einem vollen N (links unten nach rechts
oben). Das kreuzte die eigene Diagonale des Buchstabens und las sich als
DURCHGESTRICHENES N — ein Verbotszeichen als Marke. Basel hat genau das
am 19.08.2026 benannt und die neue Form angewiesen; sie hebt seine
Anweisung vom 04.08. („nicht verändern") auf.

Basels Korrektur vom 30.07. gilt weiter: die runden Kappen rücken um
ihren Radius nach innen, damit kein Punkt über die Kanten des N hinaussteht.

Palette (identisch mit dem Bericht und norns.de):
  Tinte  #262019   Papier #faf6ee   Faden #9c2630

Erzeugt alles, was das Tauri-Bündel braucht:
  icon.png (1024) · 32x32.png · 128x128.png · 128x128@2x.png · icon.ico
  und auf macOS zusätzlich icon.icns (iconutil).

Aufruf:  python3 generate.py   (aus diesem Ordner; braucht Pillow)
"""

import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

TINTE = (0x26, 0x20, 0x19, 255)
ROT = (0x9C, 0x26, 0x30, 255)
PAPIER = (0xFA, 0xF6, 0xEE, 255)
HIER = os.path.dirname(os.path.abspath(__file__))


def male(n: int) -> Image.Image:
    """Das Zeichen bei Kantenlänge n, vierfach überabgetastet."""
    u = 4
    c = n * u
    im = Image.new("RGBA", (c, c), PAPIER)
    z = ImageDraw.Draw(im)
    cx = cy = c / 2
    s = 0.60 * c
    w, d = 0.78 * s, 0.16 * s
    l, r = cx - w / 2, cx + w / 2
    t, b = cy - s / 2, cy + s / 2  # y wächst nach unten
    z.rectangle([l, t, l + d, b], fill=TINTE)
    z.rectangle([r - d, t, r, b], fill=TINTE)

    # Der Faden ist die Schräge (19.08.2026): Spitze des linken Stamms zum
    # Fuss des rechten, auf den Mittellinien der Stämme. 0.11 der Höhe —
    # kräftiger als der alte Querfaden (0.075), weil er die Schräge trägt
    # und in der 16-Punkt-Fensterleiste lesbar bleiben muss.
    dicke = 0.11 * s
    kappe = dicke / 2
    x1, y1 = l + d / 2, t + kappe
    x2, y2 = r - d / 2, b - kappe
    z.line([x1, y1, x2, y2], fill=ROT, width=round(dicke))
    for px, py in ((x1, y1), (x2, y2)):
        z.ellipse([px - kappe, py - kappe, px + kappe, py + kappe], fill=ROT)
    return im.resize((n, n), Image.LANCZOS)


def main() -> None:
    male(1024).save(os.path.join(HIER, "icon.png"))
    for n, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")]:
        male(n).save(os.path.join(HIER, name))
    male(256).save(
        os.path.join(HIER, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    if sys.platform == "darwin" and shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            satz = os.path.join(tmp, "norns.iconset")
            os.makedirs(satz)
            for n in (16, 32, 64, 128, 256, 512):
                male(n).save(os.path.join(satz, f"icon_{n}x{n}.png"))
                male(n * 2).save(os.path.join(satz, f"icon_{n}x{n}@2x.png"))
            male(1024).save(os.path.join(satz, "icon_1024x1024.png"))
            subprocess.run(
                ["iconutil", "-c", "icns", satz, "-o", os.path.join(HIER, "icon.icns")],
                check=True,
            )
    print("Norns-Symbole geschrieben.")


if __name__ == "__main__":
    main()
