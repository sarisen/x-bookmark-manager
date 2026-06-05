<div align="center">

<img src="assets/banner.png" alt="X Bookmarks Manager" width="100%" />

# X Bookmarks Manager

**X (Twitter) yer işaretlerinizi modern bir masonry görünüme dönüştüren ücretsiz Chrome eklentisi.**

Arama, yazarlara göre filtreleme, JSON dışa aktarma ve tüm sayfaları otomatik yükleme — hepsi tek bir şık arayüzde.

[Kurulum](#-kurulum) · [Özellikler](#-özellikler) · [Gizlilik](#-gizlilik)

</div>

---

## ⬇️ Kurulum

> Eklenti henüz Chrome Web Mağazası'nda değil; aşağıdaki adımlarla kolayca yükleyebilirsiniz.

1. **İndirin:** Bu sayfanın üstündeki yeşil **`Code`** butonuna tıklayın → **Download ZIP** ve dosyayı bilgisayarınıza çıkarın.
   _(veya: `git clone https://github.com/sarisen/x-bookmark-manager.git`)_
2. Chrome'da adres çubuğuna **`chrome://extensions`** yazıp açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** butonuna tıklayın ve indirdiğiniz **`x-bookmark-manager`** klasörünü seçin.
5. [x.com/i/bookmarks](https://x.com/i/bookmarks) sayfasını açın — yeni arayüz hazır! 🎉

## ✨ Özellikler

- 🧱 **Masonry grid** — yer işaretleri aya göre gruplanmış kartlar halinde
- 🔍 **Arama** ve **Yazarlar** sekmesiyle hızlı filtreleme
- ⏬ **Tümünü Yükle** — ayarlanabilir gecikmeyle tüm sayfaları otomatik çeker (varsayılan 3 sn)
- 🗑️ **Yer işaretinden çıkarma** — doğrudan kart üzerinden
- 📤 **JSON dışa aktarma** — verileriniz tamamen sizde
- ⚙️ **Ayarlar** — sayfalar arası bekleme süresi (1–60 sn)

## ⚙️ Ayarlar

Eklenti simgesine **sağ tık → Seçenekler**, veya yer işaretleri sayfasındaki **dişli simgesi**.

## 🔒 Gizlilik

Tüm veriler **yalnızca tarayıcınızda** işlenir; hiçbir veri harici bir sunucuya gönderilmez, analitik/telemetri kullanılmaz. Ayrıntılar: [PRIVACY.md](PRIVACY.md)

## 🧩 Proje yapısı

```
├── manifest.json
├── content/
│   ├── content.js    # Arayüz
│   ├── inject.js     # X API yakalama
│   ├── parser.js
│   └── styles.css
├── options/          # Ayarlar sayfası
├── icons/            # Eklenti ikonları
└── assets/           # Tanıtım görselleri
```

## 📄 Lisans

MIT
