// FredyMail uçtan uca duman testi (Playwright, demo verisi gerekir).
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

async function newPage(browser, { width, height, scheme }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: "tr-TR" });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    // giriş öncesi /api/auth/me ve yanlış parola denemesi tasarım gereği 401 döner
    if (m.text().includes("status of 401")) return;
    if (m.type() === "error" || m.type() === "warning") problems.push(`[console ${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
  return { ctx, page };
}

async function login(page) {
  await page.goto(`${BASE}/#/mail`);
  await page.getByLabel("Kullanıcı adı").fill(USER);
  await page.getByLabel("Parola").fill(PASS);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("heading", { name: "Gelen Kutusu" }).waitFor();
}

async function desktopFlow(browser, scheme) {
  const { ctx, page } = await newPage(browser, { width: 1440, height: 900, scheme });
  const tag = `desktop-${scheme}`;
  if (scheme === "light") {
    await page.goto(`${BASE}/`);
    await page.getByRole("heading", { name: "Giriş yap" }).waitFor();
    await page.screenshot({ path: `${OUT}/${tag}-01-login.png` });
    // yanlış parola → anlaşılır hata
    await page.getByLabel("Kullanıcı adı").fill(USER);
    await page.getByLabel("Parola").fill("yanlis-parola");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.getByText("hatalı").waitFor();
    log("yanlış parola hata mesajı gösterildi");
  }
  await login(page);
  await page.locator(".mrow").first().waitFor();
  log(`${scheme}: giriş + gelen kutusu`);
  await page.screenshot({ path: `${OUT}/${tag}-02-inbox.png` });

  // arama
  await page.getByLabel("Postalarda ara").fill("fiyat listesi");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Arama" }).waitFor();
  await page.locator(".mrow mark").first().waitFor();
  const n = await page.locator(".mrow").count();
  if (n < 2) problems.push(`arama sonucu az: ${n}`);
  log(`"fiyat listesi" araması (${n} sonuç, vurgulama var)`);
  await page.screenshot({ path: `${OUT}/${tag}-03-search.png` });

  // sonuca tıkla → thread
  await page.locator(".mrow", { hasText: "Nordlicht" }).first().click();
  await page.locator(".thread-head h1").waitFor();
  await page.locator(".msg-card").nth(2).waitFor();
  log("thread görünümü açıldı (3 mesaj)");

  if (scheme === "light") {
    // etiket
    await page.getByRole("button", { name: "Etiket", exact: true }).click();
    await page.getByLabel("Yeni etiket adı").fill("Tedarikçi");
    await page.locator(".menu").getByRole("button", { name: "Ekle" }).click();
    await page.locator(".thread-head .pill.tag", { hasText: "Tedarikçi" }).first().waitFor();
    await page.keyboard.press("Escape");
    log("etiket eklendi");
    // not
    const noteText = `İndirim için 200+ adet şartı var (${Date.now()})`;
    await page.getByLabel("Yeni not").fill(noteText);
    await page.getByRole("button", { name: "Notu kaydet" }).click();
    await page.locator(".note-body", { hasText: noteText }).waitFor();
    log("not eklendi");
    // ertele
    await page.getByRole("button", { name: "Ertele", exact: true }).click();
    await page.getByRole("menuitem", { name: /Yarın 09:00/ }).click();
    await page.locator(".thread-head", { hasText: "Ertelendi:" }).waitFor();
    log("ertelendi");
  }
  await page.screenshot({ path: `${OUT}/${tag}-04-thread.png` });

  // AI
  await page.getByRole("tab", { name: /AI asistan/ }).click();
  await page.getByRole("button", { name: "Yazışmayı özetle" }).click();
  await page.locator(".ai-result").waitFor();
  await page.locator(".ai-meta").waitFor();
  log("AI yazışma özeti + maliyet satırı");
  await page.screenshot({ path: `${OUT}/${tag}-05-ai.png` });
  await page.locator(".ai-result .src-chip").first().click();
  await page.locator(".msg-card").first().waitFor();
  log("kaynak çipi maile götürdü");

  if (scheme === "light") {
    await page.getByRole("tab", { name: /AI asistan/ }).click();
    await page.getByRole("button", { name: "Taslak hazırla" }).click();
    await page.getByRole("button", { name: "Taslağı düzenle" }).click();
    await page.getByRole("heading", { name: "Taslaklar" }).waitFor();
    await page.getByText("Bu bir taslaktır ve gönderilmez.").waitFor();
    if (await page.getByRole("button", { name: /^(Gönder|Send)$/i }).count()) problems.push("Gönder düğmesi bulundu!");
    log("taslak oluşturuldu, gönder düğmesi yok");
    await page.screenshot({ path: `${OUT}/${tag}-06-drafts.png` });

    // HTML mail: güvenli iframe
    await page.goto(`${BASE}/#/mail?q=Fotomarket`);
    await page.locator(".mrow", { hasText: "Fotomarket" }).first().click();
    const frame = page.locator("iframe.mail-frame");
    await frame.waitFor();
    const sandbox = await frame.getAttribute("sandbox");
    if (sandbox?.includes("allow-scripts") || sandbox?.includes("allow-same-origin")) problems.push(`iframe sandbox gevşek: ${sandbox}`);
    await page.frameLocator("iframe.mail-frame").getByRole("heading", { name: "Ortak kampanya" }).waitFor();
    log("HTML mail sandbox iframe içinde gösterildi");

    // takip görünümleri
    await page.getByRole("button", { name: /Yanıtlamam gerekenler/ }).click();
    await page.locator(".mrow", { hasText: "SJ-500" }).waitFor();
    log("yanıtlamam gerekenler listesi");
    await page.screenshot({ path: `${OUT}/${tag}-07-followups.png` });

    // kısayol yardımı
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Klavye kısayolları" }).waitFor();
    await page.keyboard.press("Escape");
    log("kısayol yardımı (?)");

    // j/k gezinme
    await page.getByRole("button", { name: "Gelen Kutusu" }).first().click();
    await page.locator(".mrow").first().waitFor();
    await page.keyboard.press("j");
    await page.locator(".mrow.selected").waitFor();
    await page.keyboard.press("j");
    log("j/k gezinme");
  }

  await page.getByRole("button", { name: "Ayarlar & Senkron" }).click();
  await page.getByRole("heading", { name: "Senkron durumu" }).waitFor();
  await page.locator(".table tbody tr").first().waitFor();
  log(`${scheme}: ayarlar sayfası`);
  await page.screenshot({ path: `${OUT}/${tag}-08-settings.png`, fullPage: true });
  await ctx.close();
}

async function mobileFlow(browser, scheme) {
  const { ctx, page } = await newPage(browser, { width: 390, height: 844, scheme });
  const tag = `mobile-${scheme}`;
  await login(page);
  await page.locator(".mrow").first().waitFor();
  await page.screenshot({ path: `${OUT}/${tag}-01-inbox.png` });
  await page.getByRole("button", { name: "Menüyü aç" }).first().click();
  await page.locator(".drawer-open .sidebar").waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${tag}-02-drawer.png` });
  await page.locator(".sidebar").getByRole("button", { name: /Gelen Kutusu/ }).first().click();
  await page.locator(".mrow").first().click();
  await page.locator(".thread-head h1").waitFor();
  const listVisible = await page.locator(".list-pane").isVisible();
  if (listVisible) problems.push("mobilde detay açıkken liste görünür");
  await page.waitForTimeout(300); // çekmece kapanma animasyonu
  await page.screenshot({ path: `${OUT}/${tag}-03-reader.png` });
  await page.getByRole("button", { name: "Listeye dön" }).click();
  await page.locator(".list-pane").waitFor();
  log(`${scheme}: mobil liste → detay → geri`);
  // yatay taşma kontrolü
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`mobilde yatay taşma: ${overflow}px`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  console.log(`FredyMail e2e → ${BASE}`);
  await desktopFlow(browser, "light");
  await desktopFlow(browser, "dark");
  await mobileFlow(browser, "light");
  await mobileFlow(browser, "dark");
} catch (e) {
  problems.push(`[hata] ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
if (problems.length) {
  console.log("\nSorunlar:");
  for (const p of problems) console.log("  ✗", p);
  process.exit(1);
}
console.log(`\nTamam: ${step} adım, konsol hatası yok. Ekran görüntüleri: ${OUT}`);
