"""E-posta HTML'inin güvenli gösterimi.

Katmanlar:
1. nh3 (Rust ammonia) ile izin listesi temizliği: script/style/iframe/form/olay öznitelikleri silinir.
2. Uzak görseller varsayılan olarak engellenir (izleme pikselleri); kullanıcı isterse açılır.
3. Sunucu yanıtı sıkı CSP ile döner (script yok, yalnızca izinli görsel kaynakları).
4. İstemci HTML'i `sandbox` özellikli iframe içinde gösterir (script ve aynı-origin erişimi yok).
"""

from __future__ import annotations

import nh3

TAGS = {
    "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "col", "colgroup", "dd", "del", "div",
    "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "ol", "p",
    "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
    "thead", "tr", "u", "ul",
}
COMMON_ATTRS = {"style", "align", "valign", "width", "height", "bgcolor", "color", "dir", "title", "border",
                "cellpadding", "cellspacing", "colspan", "rowspan", "face", "size"}
ATTRS = {t: set(COMMON_ATTRS) for t in TAGS}
ATTRS["a"] |= {"href"}
ATTRS["img"] |= {"src", "alt"}
STYLE_PROPS = {
    "color", "background-color", "font-weight", "font-style", "font-size", "font-family", "text-align",
    "text-decoration", "line-height", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
    "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "border", "border-collapse",
    "width", "max-width", "height", "vertical-align", "white-space", "display",
}
BLOCKED_IMG = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="


def sanitize_email_html(html: str, allow_remote: bool = False) -> tuple[str, int]:
    """Temizlenmiş HTML ve engellenen uzak görsel sayısını döndürür."""
    blocked = 0

    def attr_filter(tag: str, attr: str, value: str):
        nonlocal blocked
        if tag == "img" and attr == "src":
            v = value.strip().lower()
            if v.startswith("data:image/") and len(value) < 500_000:
                return value
            if v.startswith(("http://", "https://")):
                if allow_remote and v.startswith("https://"):
                    return value
                blocked += 1
                return BLOCKED_IMG
            if v.startswith("cid:"):
                return BLOCKED_IMG  # gömülü görseller MVP'de yer tutucu ile gösterilir
            return None
        if tag == "a" and attr == "href":
            v = value.strip().lower()
            return value if v.startswith(("http://", "https://", "mailto:", "tel:")) else None
        return value

    cleaned = nh3.clean(
        html,
        tags=TAGS,
        attributes=ATTRS,
        attribute_filter=attr_filter,
        url_schemes={"http", "https", "mailto", "tel", "data", "cid"},
        filter_style_properties=STYLE_PROPS,
        set_tag_attribute_values={"a": {"target": "_blank"}},
        link_rel="noopener noreferrer nofollow",
    )
    return cleaned, blocked


def csp_for(allow_remote: bool) -> str:
    img = "data: https:" if allow_remote else "data:"
    return (f"default-src 'none'; img-src {img}; style-src 'unsafe-inline'; font-src data:; "
            "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")


WRAPPER = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{{color-scheme:light}}
body{{margin:0;padding:16px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
color:#1d2433;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}}
img{{max-width:100%;height:auto}} table{{max-width:100%}} pre{{white-space:pre-wrap}}
blockquote{{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #d0d5e2;color:#4a5368}}
</style></head><body>{body}</body></html>"""


def render_document(html: str | None, text: str, allow_remote: bool) -> tuple[str, int]:
    if html:
        body, blocked = sanitize_email_html(html, allow_remote)
    else:
        import html as h

        body, blocked = f"<pre>{h.escape(text)}</pre>", 0
    return WRAPPER.format(body=body), blocked

