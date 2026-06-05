# Gizlilik Politikası — X Bookmarks Manager

**Son güncelleme:** 2 Haziran 2026

## Özet

X Bookmarks Manager, yalnızca tarayıcınızda çalışan ücretsiz bir Chrome eklentisidir. Verilerinizi sunucularımıza göndermez, üçüncü taraflarla paylaşmaz ve reklam amaçlı izleme yapmaz.

## Toplanan Veriler

Eklenti aşağıdaki verileri **yalnızca yerel cihazınızda** işler:

- X (Twitter) yer işaretleriniz (sayfa yüklenirken X'in kendi API'sinden okunur)
- Sizin eklediğiniz kişisel notlar (`chrome.storage.local` içinde saklanır)

## Veri Aktarımı

- Hiçbir veri harici bir sunucuya gönderilmez
- Analitik, telemetri veya reklam ağı kullanılmaz
- JSON dışa aktarma işlemi tamamen yerel olarak gerçekleşir; dosya doğrudan bilgisayarınıza indirilir

## İzinler

| İzin | Amaç |
|------|------|
| `storage` | Sayfalar arası bekleme süresi ayarını saklamak |
| `x.com` / `twitter.com` erişimi | Yer işaretleri sayfasında özel arayüzü göstermek ve X API yanıtlarını okumak |

## Veri Saklama ve Silme

- Notlar cihazınızda saklanmaz; yalnızca yükleme bekleme süresi tercihi kaydedilir
- Eklentiyi kaldırdığınızda veya tarayıcı verilerini temizlediğinizde notlar silinir
- Yer işareti verileri eklenti tarafından kalıcı olarak saklanmaz; her oturumda X'ten yeniden okunur

## İletişim

Sorularınız için GitHub deposundaki Issues bölümünü kullanabilirsiniz.
