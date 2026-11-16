// Викликає fn лише після паузи у вводі — щоб не перемальовувати список на кожну літеру
export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
