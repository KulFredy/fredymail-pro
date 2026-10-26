// FredyMail uçtan uca duman testi (Playwright, demo verisi + FM_AI_PROVIDER=fake gerekir).
// Kullanım: BASE_URL=http://127.0.0.1:8002 FM_USER=fatih FM_PASS=... node e2e/smoke.mjs [ekran-görüntüsü-dizini]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8002";
const USER = process.env.FM_USER ?? "fatih";
const PASS = process.env.FM_PASS ?? "demo-parola-123";
const OUT = process.argv[2] ?? "./e2e-shots";
mkdirSync(OUT, { recursive: true });

const problems = [];
let step = 0;
function log(msg) {
  console.log(`  ✓ ${++step}. ${msg}`);
}
function check(cond, msg) {
  if (!cond) throw new Error(`Beklenti tutmadı: ${msg}`);
}

async function newPage(browser, { width, height, scheme, mobile = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: "tr-TR", isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    // giriş öncesi /api/auth/me ve yanlış parola denemesi tasarım gereği 401 döner
    if (m.text().includes("status of 401")) return;
    if (m.type() === "error" || m.type() === "warning") problems.push(`[console ${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
  return { ctx, page };
}

async function noOverflow(page, where) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (sw > iw + 1) problems.push(`[overflow] ${where}: sayfa ${sw}px > pencere ${iw}px`);
}

async function shot(page, name) {
  await page.waitForTimeout(250); // animasyonlar otursun
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await noOverflow(page, name);
}

async function login(page) {
  await page.goto(`${BASE}/#/mail`);
  await page.getByLabel("Kullanıcı adı").fill(USER);
  await page.getByLabel("Parola").fill(PASS);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("heading", { name: "Gelen Kutusu" }).waitFor();
}

const hash = (page) => page.evaluate(() => decodeURIComponent(window.location.hash));

async function desktopFlow(browser, scheme) {
  const { ctx, page } = await newPage(browser, { width: 1440, height: 900, scheme });
  const tag = `desktop-${scheme}`;
  if (scheme === "light") {
    await page.goto(`${BASE}/`);
    await page.getByRole("heading", { name: "Tekrar hoş geldiniz" }).waitFor();
    await shot(page, `${tag}-01-login`);
    await page.getByLabel("Kullanıcı adı").fill(USER);
    await page.getByLabel("Parola").fill("yanlis-parola");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.getByText("hatalı").waitFor();
    log("yanlış parola hata mesajı gösterildi");
  }
  await login(page);
  await page.locator(".mrow").first().waitFor();
  log(`${scheme}: giriş + gelen kutusu`);
  await shot(page, `${tag}-02-inbox`);

  // 1) Pano: KPI kartları + grafik
  await page.getByRole("button", { name: "Pano" }).click();
  await page.locator("[data-testid=kpis] .kpi").nth(5).waitFor();
  await page.locator("[data-testid=volume-chart] svg path.b-in").first().waitFor();
  await page.getByRole("button", { name: "Bu yıl", exact: true }).click();
  await page.locator("[data-testid=top-senders] .bar-row").first().waitFor();
  check((await page.locator("[data-testid=kpis] .kpi").count()) === 6, "6 KPI kartı");
  log(`${scheme}: Pano (6 KPI, grafik, en çok yazanlar)`);
  await shot(page, `${tag}-03-pano`);

  // 2) Üst çubuktan soru sor → tablo
  const omni = page.getByLabel("Postalarda ara veya asistana sor");
  await omni.fill("bu yıl en çok kimden mail aldım?");
  await omni.press("Enter");
  await page.locator("[data-testid=ask-table] .bar-row").first().waitFor();
  check((await hash(page)).startsWith("#/sor"), "soru Sor sayfasına gitti");
  check(await page.getByText("Kurallı").isVisible(), "motor rozeti");
  log(`${scheme}: "bu yıl en çok kimden mail aldım?" → tablo`);
  await shot(page, `${tag}-04-ask`);

  // 3) satıra tıkla → filtreli liste
  await page.locator("[data-testid=ask-table] .bar-row").first().click();
  await page.locator(".mrow").first().waitFor();
  const h1 = await hash(page);
  check(h1.includes("sender=") && h1.includes("date_from="), `satır filtresi uygulandı (${h1})`);
  log(`${scheme}: satıra tıklayınca gönderen + dönem filtreli liste`);

  // 4) arama + yıl çipi + PDF çipi + "Boyut ↓"
  await omni.fill("fatura");
  await omni.press("Enter");
  await page.locator(".mrow").first().waitFor();
  const yearChip = page.locator(".facet-row[aria-label=Yıllar] .chip", { hasText: /^20\d\d/ }).first();
  await yearChip.click();
  await page.waitForFunction(() => window.location.hash.includes("year="));
  await page.locator(".facet-row .chip", { hasText: "PDF" }).first().click();
  await page.waitForFunction(() => window.location.hash.includes("file_kind=pdf"));
  await page.locator(".list-tools .menu-anchor > button").click();
  await page.getByRole("menuitemradio", { name: "Boyut ↓ (büyükten)" }).click();
  await page.waitForFunction(() => window.location.hash.includes("sort=size_desc"));
  await page.locator(".mrow").first().waitFor();
  await page.waitForTimeout(400);
  const sizes = await page.locator(".mrow").evaluateAll((rows) => rows.length);
  check(sizes > 0, "filtreli sonuç var");
  log(`${scheme}: yıl + PDF çipi + Boyut ↓ sıralaması (${sizes} sonuç)`);
  await shot(page, `${tag}-05-facets`);

  // 5) mail aç → Analiz et → özet/yapılacaklar → görevi kaydet → Yapılacaklar
  await page.locator(".mrow").first().click();
  await page.locator(".subject-line h1").waitFor();
  await page.getByTestId("analyze").click();
  await page.locator(".intel-summary").first().waitFor();
  await page.locator("[data-testid=intel-tasks] .todo").first().waitFor();
  let taskText;
  const save = page.getByTestId("save-task").first();
  if (await save.count()) {
    taskText = (await save.locator("xpath=..").locator(".todo-text").innerText()).replace(/\s*M\d+\s*/g, " ").trim();
    await save.click();
  } else {
    // AI önerisi bu yazışma için daha önce kaydedilmiş: elle benzersiz görev ekle
    taskText = `E2E görevi ${Date.now()}`;
    await page.getByLabel("Yeni görev").fill(taskText);
    await page.getByLabel("Yeni görev").press("Enter");
  }
  await page.locator("[data-testid=intel-tasks] label.todo", { hasText: taskText }).first().waitFor();
  log(`${scheme}: Analiz et → özet + yapılacaklar; "${taskText}" kaydedildi`);
  await page.getByTestId("make-draft").click();
  await page.getByTestId("draft-preview").waitFor();
  const mailto = await page.locator(".intel [data-testid=mailto]").getAttribute("href");
  check(mailto?.startsWith("mailto:"), "taslak mailto bağlantısı");
  log(`${scheme}: taslak oluştu, "E-posta programında aç" → mailto:`);
  await page.locator(".reader-scroll").evaluate((el) => (el.scrollTop = 0));
  await shot(page, `${tag}-06-reader-intel`);

  await page.getByRole("button", { name: "Yapılacaklar" }).click();
  await page.locator("[data-testid=task-groups] .task").first().waitFor();
  check(await page.locator(".task .t-text", { hasText: taskText.slice(0, 12) }).first().isVisible(), "kaydedilen görev listede");
  log(`${scheme}: kaydedilen görev Yapılacaklar sayfasında`);
  await shot(page, `${tag}-07-tasks`);

  // 6) Yanıt Bekleyenler → takip önerisi → taslak → mailto
  await page.getByRole("button", { name: "Yanıt Bekleyenler" }).click();
  await page.locator(".fu-card").first().waitFor();
  await shot(page, `${tag}-08-followups`);
  await page.locator(".fu-card .fu-main").first().click();
  await page.getByTestId("get-suggestion").click();
  await page.locator(".suggest p").first().waitFor();
  await page.locator(".suggest .act-chip").first().waitFor();
  await shot(page, `${tag}-09-followup-suggest`);
  await page.getByTestId("followup-draft").click();
  const cm = page.getByTestId("composer-mailto");
  await cm.waitFor();
  check((await cm.getAttribute("href"))?.startsWith("mailto:"), "composer mailto");
  log(`${scheme}: takip önerisi + taslak → "E-posta programında aç" (mailto:)`);
  await shot(page, `${tag}-10-composer`);
  await page.keyboard.press("Escape");

  // 7) Ayarlar
  await page.getByRole("button", { name: "Ayarlar & Senkron" }).click();
  await page.getByRole("heading", { name: "Ayarlar & Senkron" }).waitFor();
  await page.getByRole("heading", { name: "Senkron durumu" }).waitFor();
  log(`${scheme}: Ayarlar`);
  await shot(page, `${tag}-11-settings`);

  // kısayol yardımı
  await page.keyboard.press("?");
  await page.getByRole("dialog", { name: "Klavye kısayolları" }).waitFor();
  await page.keyboard.press("Escape");
  await ctx.close();
}

async function mobileFlow(browser, scheme) {
  const { ctx, page } = await newPage(browser, { width: 390, height: 844, scheme, mobile: true });
  const tag = `mobile-${scheme}`;
  await login(page);
  await page.locator(".mrow").first().waitFor();
  await shot(page, `${tag}-01-inbox`);
  await page.locator(".mrow").first().click();
  await page.locator(".subject-line h1").waitFor();
  check(!(await page.locator(".list-pane").isVisible()), "mobilde okuma tam ekran");
  await shot(page, `${tag}-02-reader`);
  await page.getByRole("button", { name: "Listeye dön" }).click();
  await page.locator(".list-pane").waitFor();
  log(`${scheme}: mobil gelen kutusu + tam ekran okuma`);

  await page.locator(".bottom-tabs button", { hasText: "Bekleyenler" }).click();
  await page.locator(".fu-card").first().waitFor();
  await page.locator(".fu-card .fu-main").first().click();
  await page.getByTestId("get-suggestion").click();
  await page.locator(".suggest p").first().waitFor();
  await shot(page, `${tag}-03-followups`);
  log(`${scheme}: mobil Yanıt Bekleyenler + takip önerisi`);

  await page.locator(".bottom-tabs button", { hasText: "Asistan" }).click();
  await page.getByRole("heading", { name: /Asistana sor/ }).waitFor();
  await page.getByRole("button", { name: "Bu ay en çok kimden mail aldım?" }).click();
  await page.locator("[data-testid=ask-result]").waitFor();
  await shot(page, `${tag}-04-ask`);

  await page.goto(`${BASE}/#/pano`);
  await page.locator("[data-testid=kpis] .kpi").nth(5).waitFor();
  await shot(page, `${tag}-05-pano`);
  await page.getByRole("button", { name: "Menüyü aç" }).click();
  await page.locator(".drawer-open .sidebar").waitFor();
  await shot(page, `${tag}-06-drawer`);
  log(`${scheme}: mobil Asistan, Pano, menü`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    console.log(`Masaüstü (${scheme})`);
    await desktopFlow(browser, scheme);
    console.log(`Mobil (${scheme})`);
    await mobileFlow(browser, scheme);
  }
} catch (e) {
  problems.push(`[hata] ${e.message}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.error("\nSORUNLAR:");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`\nTüm adımlar geçti (${step}). Ekran görüntüleri: ${OUT}`);
