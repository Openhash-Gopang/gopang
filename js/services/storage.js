// ══════════════════════════════════════════════════════════════════
// js/services/storage.js — Supabase Storage 사진 업로드
// 버킷: gopang-photos (public)
// ══════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';

const BUCKET = 'gopang-photos';

// ── 이미지 압축 (canvas 리사이즈) ────────────────────────────────
export function compressImage(file, maxWidth = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);

    img.onload = () => {
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objUrl);

      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('압축 실패')),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('이미지 로드 실패')); };
    img.src = objUrl;
  });
}

// ── Supabase Storage 업로드 → public URL 반환 ────────────────────
export async function uploadPhoto(file, userGuid) {
  try {
    // 1. 압축
    const blob = await compressImage(file);
    const ext  = 'jpg';
    const path = `${userGuid}/${Date.now()}.${ext}`;

    // 2. 업로드
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
      {
        method:  'POST',
        headers: {
          'apikey':         SUPABASE_KEY,
          'Authorization':  'Bearer ' + SUPABASE_KEY,
          'Content-Type':   'image/jpeg',
          'x-upsert':       'true',
        },
        body: blob,
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`업로드 실패: ${res.status} ${err}`);
    }

    // 3. public URL 구성
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    console.info('[Storage] 업로드 완료:', publicUrl);
    return publicUrl;

  } catch(e) {
    console.warn('[Storage] 업로드 오류:', e.message);
    return null;
  }
}
