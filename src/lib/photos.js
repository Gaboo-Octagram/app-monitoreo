/* =====================================================================
   Fotos
   ---------------------------------------------------------------------
   Las imágenes se reducen antes de guardarlas: así caben muchas más en
   el navegador (y mañana se suben más rápido a la nube). Se quitan los
   datos EXIF al redibujarlas en un canvas.
   ===================================================================== */

const PHOTO_MAX_SIDE = 900;
const PHOTO_QUALITY = 0.7;

function compressImage(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onerror = () => rej(new Error('lectura'));
    rd.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('imagen'));
      img.onload = () => {
        const sc = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * sc));
        c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}

/* Miniaturas con botón para quitar. `rm(i)` devuelve los atributos. */
const thumbsHTML = (photos, rm) => (photos || []).map((p, i) =>
  `<span class="thumb-wrap"><img class="thumb" src="${esc(p)}" alt="Foto ${i + 1}" data-action="zoom"><button type="button" class="thumb-x" ${rm(i)} aria-label="Quitar foto">×</button></span>`).join('');
