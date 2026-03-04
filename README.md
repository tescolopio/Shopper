# ⚔️ Shopper — D&D 5e Shop Generator for Foundry VTT

A web-based shop generator that pulls standardised, open-source item data from the
[Open5e API](https://open5e.com) and exports the final shop inventory as a
Foundry VTT–compatible Actor JSON. A GM can import that file directly into their
D&D 5e world to instantly spawn a fully functional merchant NPC with items, prices,
and quantities already filled in.

---

## Features

| Feature | Detail |
|---|---|
| 📖 Item Browser | Browse weapons, armor, magic items, and equipment directly from the Open5e API |
| 🔍 Live Search | Filter items by name within any category |
| 🛒 Inventory Builder | Add items, set quantities and adjust prices (with a global price-modifier %) |
| 📤 One-click Export | Generates a Foundry VTT v12 / dnd5e 3.x compatible Actor JSON and downloads it |
| 📋 Copy to Clipboard | Copy the full JSON without downloading |
| 🏪 Shop Config | Set shop name, shopkeeper, shop type, and description — all embedded in the export |

---

## Quick Start

Because the app calls an external API (`api.open5e.com`), it must be served over
HTTP rather than opened as a `file://` URL.

### Option A — Python (no install required)

```bash
cd /path/to/Shopper
python3 -m http.server 8080
# Open http://localhost:8080 in your browser
```

### Option B — Node.js `npx serve`

```bash
cd /path/to/Shopper
npx serve .
# Follow the URL printed in the terminal
```

---

## Importing into Foundry VTT

1. In Foundry VTT, open the **Actors** sidebar tab.
2. Click **Create Actor** → give it a temporary name → click **Create Actor**.
3. With the actor sheet open, click the ⚙ **cog icon** and choose **Import Data**.
4. Select the JSON file downloaded from Shopper.
5. The actor is immediately populated with the shop name, shopkeeper biography, and
   full item inventory — ready to place on the canvas.

---

## Project Structure

```
Shopper/
├── index.html   — Application shell & markup
├── styles.css   — Dark-themed responsive stylesheet
├── app.js       — Open5e API integration, inventory logic, Foundry VTT JSON export
└── README.md
```

---

## API & Data Sources

* **[Open5e](https://open5e.com)** — free, open-source SRD content under the
  [OGL](https://media.wizards.com/2016/downloads/DND/SRD-OGL_V5.1.pdf).
* Weapons & Armour come from the v2 API; Magic Items & Equipment from the v1 API.
* No API key required.

---

## Foundry VTT Compatibility

Exported files target **Foundry VTT v12** with the **dnd5e system v3.x** (`system`
data model). The schema uses the modern `system` key rather than the legacy `data`
key.

