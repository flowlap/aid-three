/**
 * Stock/reverse-image search sites usable from the preview page's "연관 이미지
 * 찾기" feature. For most sites, no automatic hand-off is possible — browsers
 * block injecting a file into another origin's upload widget, and this app has
 * no public URL for services like Google Lens's uploadbyurl to fetch from. Every
 * `imageSearchUrl` just opens the site's own image-search entry point in a new
 * tab; the caller is expected to have already copied the image to the clipboard
 * (and offered a draggable fallback) so the user can paste/drag it in there
 * themselves.
 *
 * "gettyimageskorea-pro" is the one exception: its upload endpoint is proxied
 * server-side (see lib/imageSearch/gettyImageSearchUpload.ts), so
 * RelatedImageSearch.tsx uploads automatically instead of using this site's
 * `imageSearchUrl` for that flow — `imageSearchUrl` here is only the fallback
 * destination when the automatic upload fails.
 *
 * To add a site, add one entry here — nothing else needs to change.
 */
export type ImageSearchSiteId = "getty" | "google" | "gettyimagesbank" | "gettyimageskorea-pro";

export interface ImageSearchSite {
  id: ImageSearchSiteId;
  label: string;
  keywordSearchUrl(keyword: string): string;
  imageSearchUrl(): string;
}

export const IMAGE_SEARCH_SITES: readonly ImageSearchSite[] = [
  {
    id: "getty",
    label: "게티 이미지",
    // /photos/{slug} only resolves for existing Getty tag pages (410s on an arbitrary phrase) —
    // /search/2/image-film?phrase= is the actual live full-text search, confirmed by using the
    // real search box on gettyimages.com.
    keywordSearchUrl: (keyword) => `https://www.gettyimages.com/search/2/image-film?family=creative&phrase=${encodeURIComponent(keyword)}`,
    imageSearchUrl: () => "https://www.gettyimages.com/",
  },
  {
    id: "google",
    label: "구글 이미지",
    keywordSearchUrl: (keyword) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(keyword)}`,
    imageSearchUrl: () => "https://images.google.com/",
  },
  {
    id: "gettyimagesbank",
    label: "게티이미지뱅크",
    keywordSearchUrl: (keyword) => `https://www.gettyimagesbank.com/s/?q=${encodeURIComponent(keyword)}`,
    imageSearchUrl: () => "https://www.gettyimagesbank.com/",
  },
  {
    id: "gettyimageskorea-pro",
    label: "게티이미지코리아",
    // rfpro.gettyimageskorea.com(유료 PRO 카탈로그)에는 이미지 업로드 검색 기능이 없어서,
    // 업로드 검색이 되는 mbdrive.gettyimageskorea.com(무료 카탈로그, 로그인 불필요)으로 통일했다.
    // 상세 조사 내용은 docs/superpowers/specs/2026-08-05-getty-image-search-design.md 참고.
    keywordSearchUrl: (keyword) =>
      `https://mbdrive.gettyimageskorea.com/creative/?q=${encodeURIComponent(keyword)}&cs=on&lct=rm%2Crf`,
    imageSearchUrl: () => "https://mbdrive.gettyimageskorea.com/",
  },
] as const;

export const DEFAULT_IMAGE_SEARCH_SITE: ImageSearchSiteId = "gettyimageskorea-pro";

export const IMAGE_SEARCH_SITE_STORAGE_KEY = "imageSearchSite";

export function getImageSearchSite(id: ImageSearchSiteId): ImageSearchSite {
  const site = IMAGE_SEARCH_SITES.find((s) => s.id === id);
  if (!site) throw new Error(`알 수 없는 이미지 검색 사이트입니다: ${id}`);
  return site;
}
