#!/usr/bin/env node
/** The control round from §31.3: shoot every shell state on desktop and phone in both themes,
 *  then run a DOM audit over each one and write the findings next to the screenshots.
 *
 *  This exists because a redesign is easy to declare done and hard to verify: the audit checks
 *  the things a screenshot alone will not tell you — text boxes that overlap, controls smaller
 *  than the tap target, interactive elements with no accessible name, horizontal overflow, and
 *  contrast below 4.5:1 — and fails the run when any of them appear.
 *
 *  Usage: `node e2e/visual-audit.mjs <phase> [--only=state1,state2]` with the dev server up.
 *  Output: `docs/shots/<phase>/<state>-<viewport>-<theme>.jpg` plus `audit.md`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const phase = process.argv[2] ?? "phase-1";
const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);
const outDir = resolve("docs/shots", phase);
const baseUrl = process.env.MAPOS_WEB_URL ?? "http://localhost:5173";

const VIEWPORTS = [
  { id: "1440", width: 1440, height: 900 },
  { id: "390", width: 390, height: 844 }
];
const THEMES = ["light", "dark"];

/** Each state is a URL plus an optional recipe for getting the shell into that shape.
 *  Numbered to match the list in §7.6 so an audit line can be traced back to the plan. */
const STATES = [
  { id: "01-map", url: "/", setup: closePanel },
  {
    id: "02-search-empty",
    url: "/",
    setup: async (page) => {
      await closePanel(page);
      await page.getByTestId("place-search").click();
    }
  },
  {
    id: "03-search-ai",
    url: "/",
    setup: async (page) => {
      await closePanel(page);
      await page.getByTestId("place-search").fill("kde se dá dobře stanovat u vody");
      await page.waitForTimeout(400);
    }
  },
  { id: "04-personal", url: "/?mode=personal" },
  { id: "05-discover", url: "/?mode=discover" },
  { id: "06-planning-empty", url: "/?mode=planning" },
  { id: "08-game", url: "/?mode=game" },
  {
    id: "09-layers-drawer",
    url: "/",
    setup: (page) => page.getByTestId("layers-btn").click()
  },
  {
    id: "10-basemaps-drawer",
    url: "/",
    setup: (page) => page.getByTestId("basemap-btn").click()
  },
  {
    id: "11-settings-drawer",
    url: "/",
    setup: (page) => page.getByTestId("settings-btn").click()
  }
];

async function closePanel(page) {
  const hamburger = page.getByTestId("hamburger-btn");
  if (await hamburger.count()) return;
  await page
    .locator('.panel-left-header [aria-label="Zavřít"]')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {});
}

/** Everything below runs in the page. Kept as one function so it is a single evaluate call. */
function auditPage() {
  const findings = [];
  const rects = new Map();
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")
      return false;
    // The visually-hidden idiom: on screen in the box model, invisible to the eye. Native file
    // inputs and live regions use it, and flagging them as undersized targets is noise.
    if (style.clipPath === "inset(50%)" || style.clip === "rect(0px, 0px, 0px, 0px)") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    rects.set(el, rect);
    return true;
  };
  const describe = (el) => {
    const id = el.getAttribute("data-testid");
    const cls =
      el.className && typeof el.className === "string"
        ? `.${el.className.trim().split(/\s+/)[0]}`
        : "";
    const base = id ? `[data-testid="${id}"]` : `${el.tagName.toLowerCase()}${cls}`;
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
    return text ? `${base} "${text}"` : base;
  };

  // ---- Overlapping text -------------------------------------------------
  // Two text-bearing leaves that intersect are the signature failure of the previous UI, where
  // absolutely positioned suggestion lists were drawn over the rows beneath them.
  const leaves = [...document.querySelectorAll("body *")].filter((el) => {
    if (!visible(el)) return false;
    if (el.children.length > 0) return false;
    return (el.textContent ?? "").trim().length > 1;
  });

  /** What of an element is actually on screen. A row scrolled past the bottom of a panel still
   *  reports its full rect, which read as an overlap with the sticky footer below it — it is
   *  clipped by the scrollport, not drawn over anything. */
  const onScreen = (el) => {
    let box = rects.get(el);
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const scrolls = /auto|scroll|hidden/.test(`${style.overflowY} ${style.overflowX}`);
      if (!scrolls) continue;
      const port = node.getBoundingClientRect();
      const top = Math.max(box.top, port.top);
      const bottom = Math.min(box.bottom, port.bottom);
      const left = Math.max(box.left, port.left);
      const right = Math.min(box.right, port.right);
      if (bottom <= top || right <= left) return null;
      box = { top, bottom, left, right };
    }
    return box;
  };
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = onScreen(a);
      const rb = onScreen(b);
      if (!ra || !rb) continue;
      const overlapW = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapH = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapW <= 2 || overlapH <= 2) continue;
      // Different stacking contexts are a legitimate overlay (popover over a panel).
      const za = Number(getComputedStyle(a).zIndex) || 0;
      const zb = Number(getComputedStyle(b).zIndex) || 0;
      if (za !== zb) continue;
      if (
        a.closest("[data-popup],[role=dialog],[role=tooltip]") !==
        b.closest("[data-popup],[role=dialog],[role=tooltip]")
      )
        continue;
      findings.push(
        `overlap: ${describe(a)} × ${describe(b)} (${Math.round(overlapW)}×${Math.round(overlapH)} px)`
      );
    }
  }

  // ---- Tap targets and names -------------------------------------------
  const interactive = [
    ...document.querySelectorAll("button, a[href], input, select, [role=button], [role=slider]")
  ];
  const phone = innerWidth < 900;
  for (const el of interactive) {
    if (!visible(el)) continue;
    const rect = rects.get(el);
    const name =
      el.getAttribute("aria-label") ??
      el.getAttribute("title") ??
      (el.labels?.length ? el.labels[0].textContent : null) ??
      (el.textContent ?? "").trim();
    if (!name) findings.push(`no accessible name: ${describe(el)}`);
    // Drag rails (the sheet grabber, the panel resizer) are deliberately thin in one axis; they
    // are dragged, not tapped, and §21.2 fixes the handle at 32×4.
    if (el.matches("[role=slider], [role=separator]")) continue;
    const min = phone ? 44 : 32;
    if (rect.height + 0.5 < min || rect.width + 0.5 < min) {
      findings.push(
        `tap target ${Math.round(rect.width)}×${Math.round(rect.height)} < ${min}: ${describe(el)}`
      );
    }
  }

  // ---- Horizontal overflow ---------------------------------------------
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    const culprits = [...document.querySelectorAll("body *")]
      .filter((el) => visible(el) && rects.get(el).right > innerWidth + 1)
      .slice(0, 5)
      .map(describe);
    findings.push(
      `horizontal overflow by ${document.documentElement.scrollWidth - innerWidth} px: ${culprits.join(", ")}`
    );
  }

  // ---- Contrast ---------------------------------------------------------
  // The design tokens are authored in oklch and Chromium hands them back that way, so a naive
  // "pull the numbers out of the string" parser reads `oklch(0.2 0.02 250)` as the colour
  // rgb(0.2, 0.02, 250) — which is how the first run claimed 1.27:1 for black-on-white panel
  // headings. Convert properly instead.
  const srgbFromOklab = (L, a, b) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
    return lin.map((channel) => {
      const clamped = Math.min(1, Math.max(0, channel));
      const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return encoded * 255;
    });
  };

  const parseColor = (value) => {
    const input = (value ?? "").trim();
    if (!input || input === "transparent" || input === "none") return null;
    const numbers = (text) =>
      (text.match(/-?[\d.]+%?/g) ?? []).map((token) =>
        token.endsWith("%") ? Number.parseFloat(token) / 100 : Number.parseFloat(token)
      );
    const alphaOf = (parts, index) => (parts.length > index ? parts[index] : 1);

    if (input.startsWith("oklch")) {
      const [L = 0, C = 0, hDeg = 0, ...rest] = numbers(input);
      // The hue is degrees, not a fraction, so it survives the percent handling above intact.
      const h = (hDeg * Math.PI) / 180;
      const [r, g, b] = srgbFromOklab(L, C * Math.cos(h), C * Math.sin(h));
      return { r, g, b, a: alphaOf(rest, 0) };
    }
    if (input.startsWith("oklab")) {
      const [L = 0, a = 0, bb = 0, ...rest] = numbers(input);
      const [r, g, b] = srgbFromOklab(L, a, bb);
      return { r, g, b, a: alphaOf(rest, 0) };
    }
    if (input.startsWith("color(")) {
      const [r = 0, g = 0, b = 0, ...rest] = numbers(input);
      return { r: r * 255, g: g * 255, b: b * 255, a: alphaOf(rest, 0) };
    }
    if (input.startsWith("#")) {
      const hex = input.slice(1);
      const wide = hex.length > 4;
      const step = wide ? 2 : 1;
      const channel = (index) => {
        const raw = hex.slice(index * step, index * step + step);
        return wide ? Number.parseInt(raw, 16) : Number.parseInt(raw + raw, 16);
      };
      const alpha = hex.length === 4 || hex.length === 8 ? channel(3) / 255 : 1;
      return { r: channel(0), g: channel(1), b: channel(2), a: alpha };
    }
    const parts = numbers(input);
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: alphaOf(parts, 3) };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1
  });

  // Chrome surfaces are translucent over the map, so the backdrop is a stack rather than one
  // colour. Composite upwards until it is opaque, ending on the theme's page colour.
  const backdropOf = (el) => {
    const stack = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.01) {
        stack.push(bg);
        if (bg.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    const page =
      parseColor(getComputedStyle(document.documentElement).backgroundColor) ??
      (matchMedia("(prefers-color-scheme: dark)").matches
        ? { r: 20, g: 20, b: 20, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 });
    let result = { ...page, a: 1 };
    for (let i = stack.length - 1; i >= 0; i -= 1) result = over(stack[i], result);
    return result;
  };

  for (const el of leaves) {
    const style = getComputedStyle(el);
    const parsed = parseColor(style.color);
    if (!parsed) continue;
    const bg = backdropOf(el);
    const fg = over(parsed, bg);
    const size = Number.parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    // Icons are drawn with a text font but they are not text: WCAG asks 3:1 of non-text
    // content, and holding a glyph to 4.5:1 would force the whole icon set darker than the
    // labels it sits beside.
    const icon = el.classList.contains("kit-icon") || el.classList.contains("material-symbols-rounded");
    const required = large || icon ? 3 : 4.5;
    if (ratio + 0.05 < required) {
      findings.push(`contrast ${ratio.toFixed(2)}:1 < ${required}: ${describe(el)}`);
    }
  }

  // ---- Density ----------------------------------------------------------
  // A panel that is mostly bordered boxes reads as boxes rather than as content (§31.1: at most
  // one level of enclosed area per panel).
  // Every open surface gets audited, not just the first one in the document: with a drawer over
  // the mode panel, `querySelector` returned the panel behind it and the drawer — the thing
  // being photographed — was never checked.
  for (const panel of document.querySelectorAll(
    ".panel-left-body, .shell-right-drawer-body, .tiles-sheet-body"
  )) {
    if (!visible(panel)) continue;
    const where = panel.className.trim().split(/\s+/)[0];
    const boxed = [...panel.querySelectorAll("*")].filter((el) => {
      if (!visible(el)) return false;
      // What §31.1 is about is content in a box in a box. A fill that carries no words is not
      // one of those boxes — icon badges, basemap thumbnails and the segmented control's
      // sliding indicator are all painted shapes, and counting them said the Podklady drawer
      // nested 18 surfaces when what it actually has is 18 little pictures of maps.
      if (el.getAttribute("aria-hidden") === "true") return false;
      if ((el.textContent ?? "").trim().length < 2) return false;
      const style = getComputedStyle(el);
      // A box is bordered on every side. Testing only the top counted the 1 px rule between
      // settings rows as an enclosure, so a plain list of dividers reported as nesting.
      const hasBorder = ["Top", "Right", "Bottom", "Left"].every(
        (side) => Number.parseFloat(style[`border${side}Width`]) > 0
      );
      const hasFill = (parseColor(style.backgroundColor)?.a ?? 0) > 0.02;
      return (hasBorder || hasFill) && rects.get(el).height > 24;
    });
    const nested = boxed.filter((el) => boxed.some((other) => other !== el && other.contains(el)));
    if (nested.length > 0) {
      findings.push(
        `${where} nested surfaces: ${nested.length} boxed elements inside another boxed element (${nested
          .slice(0, 4)
          .map(describe)
          .join(", ")})`
      );
    }

    // §31.3/3: how much the panel asks of the reader before they scroll. The fold is where the
    // panel stops being visible — `panel.top + innerHeight` put it a screen below the viewport
    // and counted the whole scrollable panel as if none of it needed scrolling to.
    const fold = Math.min(rects.get(panel).bottom, innerHeight);
    const aboveFold = [
      ...panel.querySelectorAll("button, a[href], input, select, [role=button], [role=slider]")
    ].filter((el) => visible(el) && rects.get(el).bottom <= fold);

    // What the panel asks of the reader is the number of *things*, not of widgets. A row that
    // repeats — stop after stop, layer after layer — asks its question once and then again in
    // the same shape, so each row counts as one; a stop with a field, a clear, a map pick and
    // a menu is one stop. Unique controls still count individually, which is what the rule is
    // there to catch.
    const unit = (el) => {
      for (let node = el.parentElement; node && node !== panel; node = node.parentElement) {
        const signature = `${node.tagName}.${(node.className ?? "").trim().split(/\s+/)[0]}`;
        const twin = [node.previousElementSibling, node.nextElementSibling].some(
          (sibling) =>
            sibling &&
            `${sibling.tagName}.${(sibling.className ?? "").trim().split(/\s+/)[0]}` === signature
        );
        if (twin) return node;
      }
      return el;
    };
    const units = new Set(aboveFold.map(unit));
    if (units.size > 12) {
      findings.push(
        `${where} density: ${units.size} interactive units above the fold (max 12, from ${aboveFold.length} controls)`
      );
    }
    const primary = aboveFold.filter(
      (el) => el.matches("[data-variant=filled]") || el.classList.contains("btn-accent")
    );
    if (primary.length > 1) {
      findings.push(
        `${where} density: ${primary.length} primary buttons above the fold (max 1): ${primary
          .slice(0, 4)
          .map(describe)
          .join(", ")}`
      );
    }

    // §31.3/4: everything in a panel starts on the same left edge.
    const rows = [...panel.querySelectorAll("*")].filter(
      (el) =>
        visible(el) &&
        el.children.length === 0 &&
        (el.textContent ?? "").trim().length > 1 &&
        !el.closest("[role=dialog],[data-popup]")
    );
    // Only the leftmost text on each line is where a row "starts". Measuring every text node
    // put right-aligned accordion chevrons and centred button labels on the same ruler as the
    // labels they sit beside, and those cannot be on a left grid by construction.
    const lineStart = new Map();
    for (const el of rows) {
      const rect = rects.get(el);
      const line = Math.round(rect.top / 4);
      const left = rect.left - rects.get(panel).left;
      if (!lineStart.has(line) || left < lineStart.get(line)) lineStart.set(line, left);
    }
    const edges = new Map();
    for (const left of lineStart.values()) {
      const rounded = Math.round(left);
      edges.set(rounded, (edges.get(rounded) ?? 0) + 1);
    }
    // The spacing scale in `tokens.css` steps in 2 px, so 2 px is the grid to hold text to.
    // Checking a 4 px one flagged every legitimate `--space-5` indent and buried the real
    // finding: an odd offset, which only comes from fractional layout.
    const offGrid = [...edges.entries()].filter(([left, count]) => left % 2 !== 0 && count >= 2);
    for (const [left, count] of offGrid.slice(0, 4)) {
      findings.push(`${where} alignment: ${count} text nodes start at ${left} px, off the 2 px grid`);
    }
  }

  // ---- Wording -----------------------------------------------------------
  // §29.3: developer-facing strings never belong in the interface, and an explanation longer
  // than a line belongs in an InfoTip.
  const DEV_TEXT =
    /\b(provider|request:|profile=|deterministick|fallback|json|osrm|mapos-[a-z]+-v\d)/i;
  const copy = [...document.querySelectorAll("p, span, small, strong, li, div")].filter(
    (el) => visible(el) && el.children.length === 0
  );
  for (const el of copy) {
    const text = (el.textContent ?? "").trim();
    if (text.length > 3 && DEV_TEXT.test(text)) {
      findings.push(`developer text in UI: ${describe(el)}`);
    }
    if (text.length > 160 && !el.closest(".kit-empty-state, .empty-state")) {
      findings.push(`paragraph of ${text.length} chars outside an empty state: ${describe(el)}`);
    }
  }

  return findings;
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const report = [
  `# Kontrolní kolo — ${phase}`,
  "",
  `Vygenerováno \`node e2e/visual-audit.mjs ${phase}\` · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
  "",
  "Audit kontroluje překryvy textu, velikost cílů dotyku, přístupné názvy, vodorovné přetečení,",
  "kontrast 4.5:1 a zanoření ohraničených ploch. Prázdná sekce = bez nálezů.",
  ""
];
let total = 0;
const consoleProblems = [];

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
      colorScheme: theme
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleProblems.push(`${viewport.id}/${theme}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleProblems.push(`${viewport.id}/${theme}: ${error}`));

    for (const state of STATES) {
      if (only && !only.includes(state.id)) continue;
      // Each state has to be the state it claims to be. Without this the layer and mode
      // residue from the previous capture came along, so "Layers drawer" was photographed
      // over whichever panel state 08 happened to leave open.
      await page
        .evaluate(() => {
          window.sessionStorage.clear();
          window.localStorage.clear();
        })
        // `about:blank` has no storage to clear before the first capture.
        .catch(() => {});
      await page.goto(`${baseUrl}${state.url}`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);
      if (state.setup) await state.setup(page);
      await page.waitForTimeout(500);

      const name = `${state.id}-${viewport.id}-${theme}`;
      await page.screenshot({ path: `${outDir}/${name}.jpg`, quality: 78, type: "jpeg" });

      const findings = await page.evaluate(auditPage);
      total += findings.length;
      report.push(`## ${name}`, "");
      if (findings.length === 0) report.push("Bez nálezů.", "");
      else {
        for (const finding of findings) report.push(`- ${finding}`);
        report.push("");
      }
      console.log(`${name}: ${findings.length} finding(s)`);
    }
    await context.close();
  }
}

await browser.close();

if (consoleProblems.length) {
  report.push("## Chyby v konzoli", "");
  for (const problem of consoleProblems) report.push(`- ${problem}`);
  report.push("");
}

await writeFile(`${outDir}/audit.md`, report.join("\n"), "utf8");
console.log(
  `\n${total} finding(s) + ${consoleProblems.length} console error(s) → ${outDir}/audit.md`
);
if (total > 0 || consoleProblems.length > 0) process.exit(1);
