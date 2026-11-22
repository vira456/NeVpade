// Стискання фото перед завантаженням: фото з телефона буває 5–10 МБ,
// а для копії документа досить 2000 px по довшій стороні (текст добре читається).
const MAX_SIDE = 2000;
const QUALITY = 0.85;
const KEEP_AS_IS = 700 * 1024; // невеликі файли не чіпаємо

/** Повертає JPEG-Blob (або той самий файл, якщо стискати не треба). Кидає Error, якщо це не зображення. */
export async function compressImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); // враховує поворот фото з телефона
  } catch {
    throw new Error('Не вдалося відкрити фото. Збережіть його як JPG або PNG і спробуйте ще раз.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_AS_IS) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // прозорий PNG → білий фон, а не чорний
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  return blob && blob.size < file.size ? blob : file;
}
