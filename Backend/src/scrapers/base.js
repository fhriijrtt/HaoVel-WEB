/**
 * BASE SCRAPER — Interface / contract yang harus diimplementasi
 * oleh setiap scraper source.
 *
 * Setiap scraper WAJIB export object dengan shape berikut:
 *
 *   {
 *     SOURCE_ID: string,          // unik, lowercase, no space. cth: 'kaito', 'novelku'
 *     BASE_URL:  string,          // domain utama source
 *     canHandleUrl(url): bool,    // return true jika URL ini milik source ini
 *     scrapeList(): Promise<ListEntry[]>,
 *     scrapeDetail(url): Promise<NovelDetail>,
 *     scrapeChapter(url): Promise<ChapterResult>,
 *   }
 *
 * Shape types:
 *
 *   ListEntry {
 *     id: string,        // HARUS diawali SOURCE_ID + '_', cth: 'kaito_roshidere'
 *     title: string,
 *     cover: string,
 *     author: string,
 *     url: string,       // URL halaman novel di source
 *   }
 *
 *   NovelDetail {
 *     id: string,
 *     title: string,
 *     cover: string,
 *     author: string,
 *     artist: string,
 *     genres: string[],
 *     synopsis: string,
 *     volumes: Volume[],
 *     updatedAt: string|null,
 *     publishedAt: string|null,
 *     source: string,    // SOURCE_ID
 *   }
 *
 *   Volume {
 *     number: number,
 *     name: string,
 *     cover: string,
 *     chapters: Chapter[],
 *   }
 *
 *   Chapter {
 *     title: string,
 *     url: string,
 *     order: number,
 *   }
 *
 *   ChapterResult {
 *     htmlContent: string,
 *     updatedAt: string|null,
 *     publishedAt: string|null,
 *   }
 */

// Tidak ada implementasi di sini — hanya dokumentasi contract.
// Gunakan sebagai referensi saat membuat scraper baru.
module.exports = {};
